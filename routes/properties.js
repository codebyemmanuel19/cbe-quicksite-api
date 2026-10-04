const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireActive } = require("../middleware/locked");
const { isOurImage } = require("../images");

const router = express.Router();

const TYPES = ["House", "Flat", "Land"];
const LISTINGS = ["Sale", "Rent"];
const STATUSES = ["Available", "Sold", "Rented"];
const INQUIRY_STATUSES = ["new", "contacted", "closed"];
const MAX_PROPERTIES = 100;
const MAX_PHOTOS = 8;
const MAX_FEATURES = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getSiteId(userId) {
  const { rows } = await db.query("SELECT id FROM sites WHERE user_id = $1", [userId]);
  return rows[0] ? rows[0].id : null;
}

function shape(row) {
  return {
    id: row.id,
    title: row.title,
    // BIGINT comes back from Postgres as text, so turn it into a real number
    price: Number(row.price),
    location: row.location,
    type: row.type,
    listing: row.listing,
    status: row.status,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    size: row.size,
    description: row.description,
    photos: row.photos,
    features: row.features,
    createdAt: row.created_at,
  };
}

// Only photos sitting in your own Cloudinary account are kept
function cleanPhotos(value) {
  if (!Array.isArray(value)) return [];
  return value.map((p) => String(p || "").trim()).filter(isOurImage).slice(0, MAX_PHOTOS);
}

// "Borehole", "Fenced", "C of O" and so on
function cleanFeatures(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const text = String(item || "").trim().replace(/\s+/g, " ").slice(0, 30);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= MAX_FEATURES) break;
  }
  return out;
}

// Land has no bedrooms, so empty is allowed. Returns null for empty, false for rubbish.
function toCount(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 50) return false;
  return n;
}

// Checks and cleans everything the browser sent, before it touches the database
function readBody(body) {
  const title = String(body.title || "").trim().replace(/\s+/g, " ");
  if (title.length < 2 || title.length > 100) {
    return { error: "Property title must be 2 to 100 characters" };
  }

  const price = Number(body.price);
  if (!Number.isInteger(price) || price < 0 || price > 100000000000) {
    return { error: "Enter a valid price" };
  }

  const location = String(body.location || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!location) return { error: "Enter where the property is" };

  const bedrooms = toCount(body.bedrooms);
  if (bedrooms === false) return { error: "Enter a valid number of bedrooms" };

  const bathrooms = toCount(body.bathrooms);
  if (bathrooms === false) return { error: "Enter a valid number of bathrooms" };

  return {
    value: {
      title,
      price,
      location,
      // Anything the form didn't send falls back to a safe value the website understands
      type: TYPES.includes(body.type) ? body.type : "House",
      listing: LISTINGS.includes(body.listing) ? body.listing : "Sale",
      status: STATUSES.includes(body.status) ? body.status : "Available",
      bedrooms,
      bathrooms,
      size: String(body.size || "").trim().slice(0, 40),
      description: String(body.description || "").trim().slice(0, 1500),
      photos: cleanPhotos(body.photos),
      features: cleanFeatures(body.features),
    },
  };
}

router.get("/", requireAuth, async (req, res) => {
  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rows } = await db.query(
    "SELECT * FROM properties WHERE site_id = $1 ORDER BY created_at DESC",
    [siteId]
  );
  res.json({ properties: rows.map(shape) });
});

// These two sit above "/:id" so the word "inquiries" is never read as an id
router.get("/inquiries/all", requireAuth, async (req, res) => {
  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rows } = await db.query(
    `SELECT i.id, i.property_id, i.property_title, i.status, i.created_at, p.location, p.price
     FROM inquiries i
     LEFT JOIN properties p ON p.id = i.property_id
     WHERE i.site_id = $1
     ORDER BY i.created_at DESC
     LIMIT 200`,
    [siteId]
  );

  res.json({
    inquiries: rows.map((r) => ({
      id: r.id,
      propertyId: r.property_id,
      propertyTitle: r.property_title,
      status: r.status,
      location: r.location || "",
      price: r.price === null ? null : Number(r.price),
      createdAt: r.created_at,
    })),
  });
});

// The agent marks a lead as contacted or closed. Not blocked when the trial ends,
// because this is their own record keeping, not editing the website.
router.put("/inquiries/:id", requireAuth, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Inquiry not found" });

  const status = String(req.body.status || "");
  if (!INQUIRY_STATUSES.includes(status)) return res.status(400).json({ error: "Choose a valid status" });

  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rowCount } = await db.query(
    "UPDATE inquiries SET status = $1 WHERE id = $2 AND site_id = $3",
    [status, req.params.id, siteId]
  );
  if (!rowCount) return res.status(404).json({ error: "Inquiry not found" });

  res.json({ ok: true });
});

// The Edit page loads one property with this
router.get("/:id", requireAuth, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Property not found" });

  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rows } = await db.query("SELECT * FROM properties WHERE id = $1 AND site_id = $2", [
    req.params.id,
    siteId,
  ]);
  if (!rows.length) return res.status(404).json({ error: "Property not found" });

  res.json({ property: shape(rows[0]) });
});

router.post("/", requireAuth, requireActive, async (req, res) => {
  const siteId = req.site.id;

  const { rows: countRows } = await db.query(
    "SELECT COUNT(*)::int AS total FROM properties WHERE site_id = $1",
    [siteId]
  );
  if (countRows[0].total >= MAX_PROPERTIES) {
    return res.status(400).json({ error: `You have reached ${MAX_PROPERTIES} properties` });
  }

  const parsed = readBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const p = parsed.value;

  const { rows } = await db.query(
    `INSERT INTO properties
       (site_id, title, price, location, type, listing, status,
        bedrooms, bathrooms, size, description, photos, features)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      siteId,
      p.title,
      p.price,
      p.location,
      p.type,
      p.listing,
      p.status,
      p.bedrooms,
      p.bathrooms,
      p.size,
      p.description,
      p.photos,
      p.features,
    ]
  );

  // The 7 free days start on the first property only. IS NULL makes sure it can never restart.
  const { rows: trialRows } = await db.query(
    `UPDATE sites SET trial_ends_at = NOW() + INTERVAL '7 days'
     WHERE id = $1 AND trial_ends_at IS NULL
     RETURNING trial_ends_at`,
    [siteId]
  );

  res.status(201).json({
    property: shape(rows[0]),
    trialStartedAt: trialRows.length ? trialRows[0].trial_ends_at : null,
  });
});

router.put("/:id", requireAuth, requireActive, async (req, res) => {
  const siteId = req.site.id;
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Property not found" });

  const parsed = readBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const p = parsed.value;

  // site_id in the WHERE is what stops one agent editing another agent's property
  const { rows } = await db.query(
    `UPDATE properties
     SET title = $1, price = $2, location = $3, type = $4, listing = $5, status = $6,
         bedrooms = $7, bathrooms = $8, size = $9, description = $10,
         photos = $11, features = $12, updated_at = NOW()
     WHERE id = $13 AND site_id = $14
     RETURNING *`,
    [
      p.title,
      p.price,
      p.location,
      p.type,
      p.listing,
      p.status,
      p.bedrooms,
      p.bathrooms,
      p.size,
      p.description,
      p.photos,
      p.features,
      req.params.id,
      siteId,
    ]
  );
  if (!rows.length) return res.status(404).json({ error: "Property not found" });

  res.json({ property: shape(rows[0]) });
});

router.delete("/:id", requireAuth, requireActive, async (req, res) => {
  const siteId = req.site.id;
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Property not found" });

  const { rowCount } = await db.query("DELETE FROM properties WHERE id = $1 AND site_id = $2", [
    req.params.id,
    siteId,
  ]);
  if (!rowCount) return res.status(404).json({ error: "Property not found" });

  res.json({ ok: true });
});

module.exports = router;