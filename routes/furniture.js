const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireActive } = require("../middleware/locked");
const { isOurImage } = require("../images");

const router = express.Router();

const MAX_PHOTOS = 6;
const AVAILABILITY = ["In stock", "Made to order"];
const STATUSES = ["Available", "Sold out"];
const ORDER_STATUSES = ["new", "contacted", "closed"];
const MAX_ITEMS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getSiteId(userId) {
  const { rows } = await db.query("SELECT id FROM sites WHERE user_id = $1", [userId]);
  return rows[0] ? rows[0].id : null;
}

function shape(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    dimensions: row.dimensions,
    material: row.material,
    color: row.color,
    availability: row.availability,
    status: row.status,
    description: row.description,
    photos: row.photos || [],
    createdAt: row.created_at,
  };
}

function text(value, max) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function readBody(body) {
  const name = text(body.name, 80);
  if (name.length < 2) return { error: "Give the piece a name, for example 3-seater leather sofa" };

  const price = Number(body.price);
  if (!Number.isInteger(price) || price < 0 || price > 100000000000) return { error: "Enter a valid price" };

  const photos = (Array.isArray(body.photos) ? body.photos : [])
    .map((x) => String(x || "").trim())
    .filter(isOurImage)
    .slice(0, MAX_PHOTOS);

  return {
    value: {
      name,
      price,
      // The owner makes their own categories: "Sofas", "Beds", "Office"...
      category: text(body.category, 30) || "Other",
      dimensions: text(body.dimensions, 60),
      material: text(body.material, 40),
      color: text(body.color, 30),
      availability: AVAILABILITY.includes(body.availability) ? body.availability : "In stock",
      status: STATUSES.includes(body.status) ? body.status : "Available",
      description: String(body.description || "").trim().slice(0, 1000),
      photos,
    },
  };
}

router.get("/", requireAuth, async (req, res) => {
  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rows } = await db.query("SELECT * FROM furniture WHERE site_id = $1 ORDER BY created_at DESC", [siteId]);
  res.json({ items: rows.map(shape) });
});

// Above "/:id" so the word "inquiries" is never read as an id
router.get("/inquiries/all", requireAuth, async (req, res) => {
  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rows } = await db.query(
    `SELECT id, item_id, item_title, status, created_at
     FROM furniture_inquiries WHERE site_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [siteId]
  );
  res.json({
    inquiries: rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      itemTitle: r.item_title,
      status: r.status,
      createdAt: r.created_at,
    })),
  });
});

router.put("/inquiries/:id", requireAuth, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Inquiry not found" });
  const status = String(req.body.status || "");
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: "Choose a valid status" });

  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rowCount } = await db.query("UPDATE furniture_inquiries SET status = $1 WHERE id = $2 AND site_id = $3", [
    status,
    req.params.id,
    siteId,
  ]);
  if (!rowCount) return res.status(404).json({ error: "Inquiry not found" });
  res.json({ ok: true });
});

router.get("/:id", requireAuth, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Piece not found" });
  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rows } = await db.query("SELECT * FROM furniture WHERE id = $1 AND site_id = $2", [req.params.id, siteId]);
  if (!rows.length) return res.status(404).json({ error: "Piece not found" });
  res.json({ item: shape(rows[0]) });
});

router.post("/", requireAuth, requireActive, async (req, res) => {
  const siteId = req.site.id;

  const { rows: c } = await db.query("SELECT COUNT(*)::int AS total FROM furniture WHERE site_id = $1", [siteId]);
  if (c[0].total >= MAX_ITEMS) return res.status(400).json({ error: `You have reached ${MAX_ITEMS} pieces` });

  const parsed = readBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const d = parsed.value;

  const { rows } = await db.query(
    `INSERT INTO furniture
       (site_id, name, category, price, dimensions, material, color, availability, status, description, photos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [siteId, d.name, d.category, d.price, d.dimensions, d.material, d.color, d.availability, d.status, d.description, d.photos]
  );
  res.status(201).json({ item: shape(rows[0]) });
});

router.put("/:id", requireAuth, requireActive, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Piece not found" });
  const parsed = readBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const d = parsed.value;

  const { rows } = await db.query(
    `UPDATE furniture
     SET name = $1, category = $2, price = $3, dimensions = $4, material = $5, color = $6,
         availability = $7, status = $8, description = $9, photos = $10, updated_at = NOW()
     WHERE id = $11 AND site_id = $12 RETURNING *`,
    [d.name, d.category, d.price, d.dimensions, d.material, d.color, d.availability, d.status, d.description, d.photos, req.params.id, req.site.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Piece not found" });
  res.json({ item: shape(rows[0]) });
});

router.delete("/:id", requireAuth, requireActive, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Piece not found" });
  const { rowCount } = await db.query("DELETE FROM furniture WHERE id = $1 AND site_id = $2", [
    req.params.id,
    req.site.id,
  ]);
  if (!rowCount) return res.status(404).json({ error: "Piece not found" });
  res.json({ ok: true });
});

module.exports = router;