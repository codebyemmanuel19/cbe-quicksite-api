const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireActive } = require("../middleware/locked");
const { isOurImage } = require("../images");

const router = express.Router();

const CATEGORIES = ["Rice", "Soups & Swallow", "Grills", "Snacks", "Drinks", "Desserts"];
const STATUSES = ["Available", "Sold out"];
const ORDER_STATUSES = ["new", "contacted", "closed"];
const MAX_DISHES = 200;
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
    description: row.description,
    status: row.status,
    photo: row.photo,
    createdAt: row.created_at,
  };
}

function readBody(body) {
  const name = String(body.name || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) return { error: "Dish name must be 2 to 80 characters" };

  const price = Number(body.price);
  if (!Number.isInteger(price) || price < 0 || price > 100000000) return { error: "Enter a valid price" };

  const photo = String(body.photo || "").trim();

  return {
    value: {
      name,
      price,
      category: CATEGORIES.includes(body.category) ? body.category : "Rice",
      status: STATUSES.includes(body.status) ? body.status : "Available",
      description: String(body.description || "").trim().slice(0, 200),
      photo: photo && isOurImage(photo) ? photo : "",
    },
  };
}

router.get("/", requireAuth, async (req, res) => {
  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rows } = await db.query("SELECT * FROM dishes WHERE site_id = $1 ORDER BY created_at ASC", [siteId]);
  res.json({ dishes: rows.map(shape) });
});

// Above "/:id" so the word "orders" is never read as an id
router.get("/orders/all", requireAuth, async (req, res) => {
  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rows } = await db.query(
    `SELECT id, summary, customer_name, status, created_at
     FROM dish_orders WHERE site_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [siteId]
  );
  res.json({
    inquiries: rows.map((r) => ({
      id: r.id,
      summary: r.summary,
      name: r.customer_name,
      status: r.status,
      createdAt: r.created_at,
    })),
  });
});

router.put("/orders/:id", requireAuth, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Order not found" });
  const status = String(req.body.status || "");
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: "Choose a valid status" });

  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rowCount } = await db.query("UPDATE dish_orders SET status = $1 WHERE id = $2 AND site_id = $3", [
    status,
    req.params.id,
    siteId,
  ]);
  if (!rowCount) return res.status(404).json({ error: "Order not found" });
  res.json({ ok: true });
});

router.get("/:id", requireAuth, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Dish not found" });
  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rows } = await db.query("SELECT * FROM dishes WHERE id = $1 AND site_id = $2", [req.params.id, siteId]);
  if (!rows.length) return res.status(404).json({ error: "Dish not found" });
  res.json({ dish: shape(rows[0]) });
});

router.post("/", requireAuth, requireActive, async (req, res) => {
  const siteId = req.site.id;

  const { rows: c } = await db.query("SELECT COUNT(*)::int AS total FROM dishes WHERE site_id = $1", [siteId]);
  if (c[0].total >= MAX_DISHES) return res.status(400).json({ error: `You have reached ${MAX_DISHES} dishes` });

  const parsed = readBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const d = parsed.value;

  const { rows } = await db.query(
    `INSERT INTO dishes (site_id, name, category, price, description, status, photo)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [siteId, d.name, d.category, d.price, d.description, d.status, d.photo]
  );
  res.status(201).json({ dish: shape(rows[0]) });
});

router.put("/:id", requireAuth, requireActive, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Dish not found" });
  const parsed = readBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const d = parsed.value;

  const { rows } = await db.query(
    `UPDATE dishes SET name = $1, category = $2, price = $3, description = $4, status = $5, photo = $6,
            updated_at = NOW()
     WHERE id = $7 AND site_id = $8 RETURNING *`,
    [d.name, d.category, d.price, d.description, d.status, d.photo, req.params.id, req.site.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Dish not found" });
  res.json({ dish: shape(rows[0]) });
});

router.delete("/:id", requireAuth, requireActive, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Dish not found" });
  const { rowCount } = await db.query("DELETE FROM dishes WHERE id = $1 AND site_id = $2", [
    req.params.id,
    req.site.id,
  ]);
  if (!rowCount) return res.status(404).json({ error: "Dish not found" });
  res.json({ ok: true });
});

module.exports = router;