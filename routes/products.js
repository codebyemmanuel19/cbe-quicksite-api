const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireActive } = require("../middleware/locked");
const { isOurImage } = require("../images");

const router = express.Router();

const TAGS = ["", "New", "Most loved", "Pre-order", "Limited", "Sale"];
const MAX_PRODUCTS = 100;
const MAX_PHOTOS = 4;
const MAX_OPTIONS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getSiteId(userId) {
  const { rows } = await db.query("SELECT id FROM sites WHERE user_id = $1", [userId]);
  return rows[0] ? rows[0].id : null;
}

function shape(row) {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    description: row.description,
    photos: row.photos,
    sizes: row.sizes,
    colors: row.colors,
    tag: row.tag,
    soldOut: row.sold_out,
    categoryId: row.category_id,
    category: row.category_name || "",
    createdAt: row.created_at,
  };
}

function cleanOptions(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const text = String(item || "").trim().slice(0, 20);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

// Only photos sitting in your own Cloudinary account are kept
function cleanPhotos(value) {
  if (!Array.isArray(value)) return [];
  return value.map((p) => String(p || "").trim()).filter(isOurImage).slice(0, MAX_PHOTOS);
}

// Checks and cleans everything the browser sent, before it touches the database
async function readBody(body, siteId) {
  const name = String(body.name || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) return { error: "Product name must be 2 to 80 characters" };

  const price = Number(body.price);
  if (!Number.isInteger(price) || price < 0 || price > 100000000) {
    return { error: "Enter a valid price" };
  }

  let categoryId = body.categoryId ? String(body.categoryId) : null;
  if (categoryId) {
    if (!UUID.test(categoryId)) return { error: "Choose a valid category" };
    // The category must belong to this same shop
    const { rows } = await db.query("SELECT 1 FROM categories WHERE id = $1 AND site_id = $2", [
      categoryId,
      siteId,
    ]);
    if (!rows.length) return { error: "Choose a valid category" };
  }

  return {
    value: {
      name,
      price,
      categoryId,
      description: String(body.description || "").trim().slice(0, 1000),
      tag: TAGS.includes(body.tag) ? body.tag : "",
      soldOut: body.soldOut === true,
      photos: cleanPhotos(body.photos),
      sizes: cleanOptions(body.sizes),
      colors: cleanOptions(body.colors),
    },
  };
}

router.get("/", requireAuth, async (req, res) => {
  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your shop first" });

  const { rows } = await db.query(
    `SELECT p.*, c.name AS category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.site_id = $1
     ORDER BY p.created_at DESC`,
    [siteId]
  );
  res.json({ products: rows.map(shape) });
});

router.post("/", requireAuth, requireActive, async (req, res) => {
  const siteId = req.site.id;

  const { rows: countRows } = await db.query(
    "SELECT COUNT(*)::int AS total FROM products WHERE site_id = $1",
    [siteId]
  );
  if (countRows[0].total >= MAX_PRODUCTS) {
    return res.status(400).json({ error: `You have reached ${MAX_PRODUCTS} products` });
  }

  const parsed = await readBody(req.body, siteId);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const p = parsed.value;

  const { rows } = await db.query(
    `INSERT INTO products (site_id, category_id, name, price, description, photos, sizes, colors, tag, sold_out)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [siteId, p.categoryId, p.name, p.price, p.description, p.photos, p.sizes, p.colors, p.tag, p.soldOut]
  );

  // The 7 free days start on the first product only. IS NULL makes sure it can never restart.
  const { rows: trialRows } = await db.query(
    `UPDATE sites SET trial_ends_at = NOW() + INTERVAL '7 days'
     WHERE id = $1 AND trial_ends_at IS NULL
     RETURNING trial_ends_at`,
    [siteId]
  );

  res.status(201).json({
    product: shape(rows[0]),
    trialStartedAt: trialRows.length ? trialRows[0].trial_ends_at : null,
  });
});

router.put("/:id", requireAuth, requireActive, async (req, res) => {
  const siteId = req.site.id;
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Product not found" });

  const parsed = await readBody(req.body, siteId);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const p = parsed.value;

  // site_id in the WHERE is what stops one vendor editing another vendor's product
  const { rows } = await db.query(
    `UPDATE products
     SET category_id = $1, name = $2, price = $3, description = $4, photos = $5,
         sizes = $6, colors = $7, tag = $8, sold_out = $9, updated_at = NOW()
     WHERE id = $10 AND site_id = $11
     RETURNING *`,
    [p.categoryId, p.name, p.price, p.description, p.photos, p.sizes, p.colors, p.tag, p.soldOut, req.params.id, siteId]
  );
  if (!rows.length) return res.status(404).json({ error: "Product not found" });

  res.json({ product: shape(rows[0]) });
});

router.delete("/:id", requireAuth, requireActive, async (req, res) => {
  const siteId = req.site.id;
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Product not found" });

  const { rowCount } = await db.query("DELETE FROM products WHERE id = $1 AND site_id = $2", [
    req.params.id,
    siteId,
  ]);
  if (!rowCount) return res.status(404).json({ error: "Product not found" });

  res.json({ ok: true });
});

module.exports = router;