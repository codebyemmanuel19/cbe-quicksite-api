const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { COUNTRIES } = require("../countries");
const { statusFor } = require("../middleware/locked");

const router = express.Router();

// A shop is hidden when a paid plan lapsed for too long, or when you suspend it.
// Shops with 3 items or fewer are free and never go offline.
async function isOffline(site) {
  if (site.is_suspended) return true;
  const { status } = await statusFor(site);
  return status === "offline";
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
  if (!site || (await isOffline(site))) return res.status(404).json({ error: "Shop not found" });

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

// Tells the browser WHY a shop did not open: offline (owner has not paid) or no such address
router.get("/shop/:slug/status", async (req, res) => {
  const site = await loadBySlug(req.params.slug);
  if (!site) return res.json({ state: "missing" });
  if (await isOffline(site)) return res.json({ state: "offline", name: site.business_name });
  res.json({ state: "live", name: site.business_name });
});

router.get("/shop/:slug/products", async (req, res) => {
  const site = await loadBySlug(req.params.slug);
  if (!site || (await isOffline(site))) return res.status(404).json({ error: "Shop not found" });

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
  if (!site || (await isOffline(site))) return res.status(404).json({ error: "Shop not found" });

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


// ---- Cars ----

router.get("/shop/:slug/cars", async (req, res) => {
  const site = await loadBySlug(req.params.slug);
  if (!site || (await isOffline(site))) return res.status(404).json({ error: "Shop not found" });

  const { rows } = await db.query(
    `SELECT id, title, make, model, year, price, condition, mileage, transmission,
            fuel, color, location, status, description, photos
     FROM cars
     WHERE site_id = $1
     ORDER BY created_at DESC`,
    [site.id]
  );

  res.json({
    cars: rows.map((r) => ({
      id: r.id,
      title: r.title,
      make: r.make,
      model: r.model,
      year: r.year,
      price: Number(r.price),
      condition: r.condition,
      mileage: r.mileage,
      transmission: r.transmission,
      fuel: r.fuel,
      color: r.color,
      location: r.location,
      status: r.status,
      description: r.description,
      photos: r.photos,
    })),
  });
});

// ---- Restaurant ----

router.get("/shop/:slug/dishes", async (req, res) => {
  const site = await loadBySlug(req.params.slug);
  if (!site || (await isOffline(site))) return res.status(404).json({ error: "Shop not found" });

  const { rows } = await db.query(
    `SELECT id, name, category, price, description, status, photo, photos
     FROM dishes
     WHERE site_id = $1
     ORDER BY created_at ASC`,
    [site.id]
  );

  res.json({
    dishes: rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      price: Number(r.price),
      description: r.description,
      status: r.status,
      photo: (r.photos && r.photos[0]) || r.photo || "",
      photos: r.photos && r.photos.length ? r.photos : r.photo ? [r.photo] : [],
    })),
  });
});

// ---- Furniture ----

router.get("/shop/:slug/furniture", async (req, res) => {
  const site = await loadBySlug(req.params.slug);
  if (!site || (await isOffline(site))) return res.status(404).json({ error: "Shop not found" });

  const { rows } = await db.query(
    `SELECT id, name, category, price, dimensions, material, color, availability, status, description, photos
     FROM furniture WHERE site_id = $1 ORDER BY created_at DESC`,
    [site.id]
  );

  res.json({
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      price: Number(r.price),
      dimensions: r.dimensions,
      material: r.material,
      color: r.color,
      availability: r.availability,
      status: r.status,
      description: r.description,
      photos: r.photos || [],
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
  if (!site || (await isOffline(site))) return res.status(404).json({ error: "Shop not found" });

  // Restaurants: the customer's order is saved so the owner sees it on the dashboard
  if (site.business_type === "restaurant") {
    const summary = String(req.body.propertyTitle || "").trim().slice(0, 600);
    const name = String(req.body.name || "").trim().slice(0, 60);
    if (!summary) return res.status(400).json({ error: "Empty order" });
    await db.query("INSERT INTO dish_orders (site_id, summary, customer_name) VALUES ($1, $2, $3)", [
      site.id,
      summary,
      name,
    ]);
    return res.status(201).json({ ok: true });
  }

  const propertyId = String(req.body.propertyId || "");

  // Furniture: same button. The title still comes from the database.
  if (site.business_type === "furniture") {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId)) {
      return res.status(400).json({ error: "Piece not found" });
    }
    const { rows: piece } = await db.query("SELECT name FROM furniture WHERE id = $1 AND site_id = $2", [
      propertyId,
      site.id,
    ]);
    if (!piece.length) return res.status(404).json({ error: "Piece not found" });
    await db.query("INSERT INTO furniture_inquiries (site_id, item_id, item_title) VALUES ($1, $2, $3)", [
      site.id,
      propertyId,
      piece[0].name,
    ]);
    return res.status(201).json({ ok: true });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId)) {
    return res.status(400).json({ error: "Property not found" });
  }

  // Car dealers use the same button. The title still comes from the database.
  if (site.business_type === "cars") {
    const { rows: car } = await db.query("SELECT title FROM cars WHERE id = $1 AND site_id = $2", [
      propertyId,
      site.id,
    ]);
    if (!car.length) return res.status(404).json({ error: "Car not found" });
    await db.query("INSERT INTO car_inquiries (site_id, car_id, car_title) VALUES ($1, $2, $3)", [
      site.id,
      propertyId,
      car[0].title,
    ]);
    return res.status(201).json({ ok: true });
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