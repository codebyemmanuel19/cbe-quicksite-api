const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { COUNTRIES } = require("../countries");
const { statusFor } = require("../middleware/locked");

const router = express.Router();import { useEffect, useState } from "react";
import { api } from "./api";
import { useShop } from "./shop/useShop";
import ClothingSite from "./ClothingSite/ClothingSite";
import HairSite from "./HairSite/HairSite";
import SkincareSite from "./SkincareSite/SkincareSite";
import PerfumeSite from "./PerfumeSite/PerfumeSite";
import JewellerySite from "./JewellerySite/JewellerySite";
import GadgetsSite from "./GadgetsSite/GadgetsSite";
import RealEstateSite from "./RealEstateSite/Site";
import CarSite from "./CarSite/Site";
import RestaurantSite from "./RestaurantSite/Site";

// The business type the vendor picked at setup decides the look
const TEMPLATES = {
  clothing: ClothingSite,
  hair: HairSite,
  skincare: SkincareSite,
  perfume: PerfumeSite,
  jewellery: JewellerySite,
  gadgets: GadgetsSite,
  realestate: RealEstateSite,
  cars: CarSite,
  restaurant: RestaurantSite,
};


// The page for a website that cannot open. Says clearly whether it is offline or does not exist.
function Unavailable({ slug }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!slug) return;
    api.get(`/public/shop/${slug}/status`)
      .then(setInfo)
      .catch(() => setInfo({ state: "missing" }));
  }, [slug]);

  const offline = info && info.state === "offline";
  const missing = info && info.state !== "offline";

  return (
    <div className="un">
      <style>{`
        .un { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: #f6f7fb; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; }
        .un-card { width: 100%; max-width: 420px; padding: 34px 26px; text-align: center; background: #fff; border-radius: 22px; box-shadow: 0 10px 40px rgba(15, 23, 42, .08); animation: un-in .3s ease-out; }
        .un-ico { width: 64px; height: 64px; margin: 0 auto 18px; display: grid; place-items: center; border-radius: 50%; background: #fff7ed; font-size: 30px; }
        .un h1 { margin: 0 0 10px; font-size: 24px; line-height: 1.25; }
        .un p { margin: 0 0 8px; color: #475569; font-size: 15px; line-height: 1.55; }
        .un-name { font-weight: 700; color: #0f172a; }
        .un-owner { margin-top: 22px; padding-top: 18px; border-top: 1px solid #eef0f4; font-size: 13.5px; color: #64748b; }
        .un a { color: #2563eb; font-weight: 700; text-decoration: none; }
        @keyframes un-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>

      {info && (
        <div className="un-card">
          <div className="un-ico">{offline ? "🔒" : "🔎"}</div>

          {offline && (
            <>
              <h1>This website is currently offline</h1>
              <p>
                <span className="un-name">{info.name}</span> is not available right now.
              </p>
              <p>Please check back later.</p>
              <div className="un-owner">
                Are you the owner? <a href="https://cbequicksite.com/login">Log in</a> to bring your website back online.
              </div>
            </>
          )}

          {missing && (
            <>
              <h1>We can't find this website</h1>
              <p>Check the address and try again.</p>
              <div className="un-owner">
                Want a website like this? <a href="https://cbequicksite.com">Create yours</a>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// What people see for a moment while the shop loads: the shape of a website, softly pulsing
function ShopLoader() {
  return (
    <div className="sl" aria-busy="true" aria-label="Loading">
      <style>{`
        .sl { min-height: 100vh; background: #f8f7f4; padding: 0 0 40px; animation: sl-in .25s ease-out; }
        .sl-bar { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; background: #fff; border-bottom: 1px solid #eeece6; }
        .sl-logo { display: flex; align-items: center; gap: 10px; }
        .sl-b { background: linear-gradient(90deg, #ebe8e1 25%, #f5f3ee 50%, #ebe8e1 75%); background-size: 200% 100%; animation: sl-shine 1.3s linear infinite; }
        .sl-dot { width: 34px; height: 34px; border-radius: 50%; }
        .sl-line { height: 12px; border-radius: 6px; }
        .sl-hero { margin: 16px 18px; height: 210px; border-radius: 20px; }
        .sl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0 18px; }
        .sl-card { border-radius: 16px; background: #fff; padding: 10px; }
        .sl-img { height: 120px; border-radius: 12px; margin-bottom: 10px; }
        @media (min-width: 720px) { .sl-grid { grid-template-columns: repeat(4, 1fr); max-width: 1000px; margin: 0 auto; } .sl-hero { max-width: 964px; margin: 18px auto; } }
        @keyframes sl-shine { to { background-position: -200% 0; } }
        @keyframes sl-in { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      <div className="sl-bar">
        <div className="sl-logo">
          <div className="sl-b sl-dot" />
          <div className="sl-b sl-line" style={{ width: 110 }} />
        </div>
        <div className="sl-b sl-dot" />
      </div>

      <div className="sl-b sl-hero" />

      <div className="sl-grid">
        {[0, 1, 2, 3].map((i) => (
          <div className="sl-card" key={i}>
            <div className="sl-b sl-img" />
            <div className="sl-b sl-line" style={{ width: "80%", marginBottom: 8 }} />
            <div className="sl-b sl-line" style={{ width: "45%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// kemisboutique.cbequicksite.com loads this. It asks the API which
// kind of shop this is, then hands over to that template.
export default function ShopRouter({ basePath = "" }) {
  const { slug, store, loading, notFound } = useShop();

  if (loading) {
    return <ShopLoader />;
  }

  if (notFound || !store) {
    return <Unavailable slug={slug} />;
  }

  const Template = TEMPLATES[store.businessType] || ClothingSite;
  return <Template basePath={basePath} slug={slug} />;
}

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