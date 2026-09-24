const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireActive } = require("../middleware/locked");

const router = express.Router();
const MAX_CATEGORIES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Always the signed-in vendor's own shop, never an id sent by the browser
async function getSiteId(userId) {
  const { rows } = await db.query("SELECT id FROM sites WHERE user_id = $1", [userId]);
  return rows[0] ? rows[0].id : null;
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 30);
}

router.get("/", requireAuth, async (req, res) => {
  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your shop first" });

  const { rows } = await db.query(
    "SELECT id, name, position FROM categories WHERE site_id = $1 ORDER BY position, name",
    [siteId]
  );
  res.json({ categories: rows });
});

router.post("/", requireAuth, requireActive, async (req, res) => {
  const siteId = req.site.id;

  const name = cleanName(req.body.name);
  if (name.length < 2) return res.status(400).json({ error: "Category name is too short" });

  const { rows: countRows } = await db.query(
    "SELECT COUNT(*)::int AS total FROM categories WHERE site_id = $1",
    [siteId]
  );
  if (countRows[0].total >= MAX_CATEGORIES) {
    return res.status(400).json({ error: `You can have up to ${MAX_CATEGORIES} categories` });
  }

  try {
    const { rows } = await db.query(
      "INSERT INTO categories (site_id, name, position) VALUES ($1, $2, $3) RETURNING id, name, position",
      [siteId, name, countRows[0].total]
    );
    res.status(201).json({ category: rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "You already have that category" });
    throw err;
  }
});

router.put("/:id", requireAuth, requireActive, async (req, res) => {
  const siteId = req.site.id;
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Category not found" });

  const name = cleanName(req.body.name);
  if (name.length < 2) return res.status(400).json({ error: "Category name is too short" });

  try {
    // site_id in the WHERE is what stops one vendor touching another vendor's category
    const { rows } = await db.query(
      "UPDATE categories SET name = $1 WHERE id = $2 AND site_id = $3 RETURNING id, name, position",
      [name, req.params.id, siteId]
    );
    if (!rows.length) return res.status(404).json({ error: "Category not found" });
    res.json({ category: rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "You already have that category" });
    throw err;
  }
});

router.delete("/:id", requireAuth, requireActive, async (req, res) => {
  const siteId = req.site.id;
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Category not found" });

  // Products in it are not deleted, they just lose the category
  const { rowCount } = await db.query("DELETE FROM categories WHERE id = $1 AND site_id = $2", [
    req.params.id,
    siteId,
  ]);
  if (!rowCount) return res.status(404).json({ error: "Category not found" });
  res.json({ ok: true });
});

module.exports = router;