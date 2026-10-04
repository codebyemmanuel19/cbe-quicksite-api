const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { COUNTRIES } = require("../countries");

const router = express.Router();

// A shop is hidden when it is unpaid for too long, or when you suspend it
function isOffline(site) {
  if (site.is_suspended) return true;
  const now = Date.now();
  const paid = site.paid_until ? new Date(site.paid_until).getTime() : 0;
  if (paid > now) return false;
  if (!site.trial_ends_at) return false; // brand new shop, still loading products
  const trial = new Date(site.trial_ends_at).getTime();
  if (trial > now) return false;
  return now > Math.max(trial, paid) + 30 * 24 * 60 * 60 * 1000;
}

async function loadBySlug(slug) {
  const clean = String(slug || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{3,30}$/.test(clean)) return null;
  const { rows } = await db.query("SELECT * FROM sites WHERE slug = $1", [clean]);
  return rows[0] || null;
}

// Everything the storefront needs to draw itself. No bank details here on purpose,
// those only come back after a real order, so nobody can scrape account numbers.
router.get("/shop/:slug", async (req, res) => {
  const site = await loadBySlug(req.params.slug);
  if (!site || isOffline(site)) return res.status(404).json({ error: "Shop not found" });

  const money = COUNTRIES[site.country] || COUNTRIES.NG;

  const { rows: categories } = await db.query(
    "SELECT id, name FROM categories WHERE site_id = $1 ORDER BY position, name",
    [site.id]
  );

  res.json({
    shop: {
      slug: site.slug,
      businessType: site.business_type,
      currency: site.currency,
      symbol: money.symbol,
      dialCode: money.dialCode,
      businessName: site.business_name,
      heroLabel: site.hero_label,
      heroHeadline: site.hero_headline,
      about: site.about,
      logo: site.logo_url,
      cover: site.cover_url,
      whatsapp: site.whatsapp,
      phone: site.phone,
      email: site.email,
      address: site.address,
      tiktok: site.tiktok,
      facebook: site.facebook,
      instagram: site.instagram,
    },
    checkout: {
      payOnDelivery: site.pay_on_delivery,
      deliveryFeeFirst: site.delivery_fee_first,
      payBeforeDelivery: site.pay_before_delivery,
      offersDelivery: site.offers_delivery,
      areas: site.delivery_areas,
      offersPickup: site.offers_pickup,
      pickupAddress: site.pickup_address,
    },
    categories,
  });
});

router.get("/shop/:slug/products", async (req, res) => {
  const site = await loadBySlug(req.params.slug);
  if (!site || isOffline(site)) return res.status(404).json({ error: "Shop not found" });

  const { rows } = await db.query(
    `SELECT p.id, p.name, p.price, p.description, p.photos, p.sizes, p.colors, p.variants,
            p.tag, p.sold_out, p.category_id, c.name AS category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.site_id = $1
     ORDER BY p.created_at DESC`,
    [site.id]
  );

  res.json({
    products: rows.map((r) => ({
      id: r.id,
      name: r.name,
      price: r.price,
      description: r.description,
      photos: r.photos,
      sizes: r.sizes,
      colors: r.colors,
      variants: r.variants || [],
      tag: r.tag,
      soldOut: r.sold_out,
      categoryId: r.category_id,
      category: r.category_name || "",
    })),
  });
});

// ---- Real estate ----

// Everything an agent has listed. Same offline rules as the shops.
router.get("/shop/:slug/properties", async (req, res) => {
  const site = await loadBySlug(req.params.slug);
  if (!site || isOffline(site)) return res.status(404).json({ error: "Shop not found" });

  const { rows } = await db.query(
    `SELECT id, title, price, location, type, listing, status,
            bedrooms, bathrooms, size, description, photos, features
     FROM properties
     WHERE site_id = $1
     ORDER BY created_at DESC`,
    [site.id]
  );

  res.json({
    properties: rows.map((r) => ({
      id: r.id,
      title: r.title,
      // price is BIGINT, so Postgres hands it back as text
      price: Number(r.price),
      location: r.location,
      type: r.type,
      listing: r.listing,
      status: r.status,
      bedrooms: r.bedrooms,
      bathrooms: r.bathrooms,
      size: r.size,
      description: r.description,
      photos: r.photos,
      features: r.features,
    })),
  });
});

// Stops one visitor filling the agent's inquiry list
const inquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again later." },
});

// A visitor tapped "Ask the agent on WhatsApp". We note it so the agent sees interest.
router.post("/shop/:slug/inquiries", inquiryLimiter, async (req, res) => {
  const site = await loadBySlug(req.params.slug);
  if (!site || isOffline(site)) return res.status(404).json({ error: "Shop not found" });

  const propertyId = String(req.body.propertyId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId)) {
    return res.status(400).json({ error: "Property not found" });
  }

  // The title is taken from the database, never from the browser, so nobody can post junk
  const { rows: found } = await db.query(
    "SELECT title FROM properties WHERE id = $1 AND site_id = $2",
    [propertyId, site.id]
  );
  if (!found.length) return res.status(404).json({ error: "Property not found" });

  await db.query(
    "INSERT INTO inquiries (site_id, property_id, property_title) VALUES ($1, $2, $3)",
    [site.id, propertyId, found[0].title]
  );

  res.status(201).json({ ok: true });
});

module.exports = router;