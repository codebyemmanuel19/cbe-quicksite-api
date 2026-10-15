const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireActive } = require("../middleware/locked");
const { isOurImage } = require("../images");

const router = express.Router();

const CONDITIONS = ["Brand new", "Foreign used", "Nigerian used"];
const GEARS = ["Automatic", "Manual"];
const FUELS = ["Petrol", "Diesel", "Hybrid", "Electric"];
const STATUSES = ["Available", "Reserved", "Sold"];
const INQUIRY_STATUSES = ["new", "contacted", "closed"];
const MAX_CARS = 100;
const MAX_PHOTOS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The tables create themselves the first time the server starts. Nothing to run by hand.
// The database only allowed the old business types. The app already checks the type
// (TYPES in routes/sites.js), so this old rule is removed and new types need no database change.
const ready = db
  .query("ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_business_type_check")
  .then(() => db.query(
    `CREATE TABLE IF NOT EXISTS cars (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
       title TEXT NOT NULL,
       make TEXT NOT NULL DEFAULT '',
       model TEXT NOT NULL DEFAULT '',
       year INT,
       price BIGINT NOT NULL,
       condition TEXT NOT NULL DEFAULT 'Foreign used',
       mileage INT,
       transmission TEXT NOT NULL DEFAULT 'Automatic',
       fuel TEXT NOT NULL DEFAULT 'Petrol',
       color TEXT NOT NULL DEFAULT '',
       location TEXT NOT NULL DEFAULT '',
       status TEXT NOT NULL DEFAULT 'Available',
       description TEXT NOT NULL DEFAULT '',
       photos TEXT[] NOT NULL DEFAULT '{}',
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     );
     CREATE INDEX IF NOT EXISTS cars_site_idx ON cars (site_id);
     CREATE TABLE IF NOT EXISTS car_inquiries (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
       car_id UUID,
       car_title TEXT NOT NULL DEFAULT '',
       status TEXT NOT NULL DEFAULT 'new',
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     );
     CREATE INDEX IF NOT EXISTS car_inquiries_site_idx ON car_inquiries (site_id);`
  ))
  .catch((err) => console.error("Could not create car tables:", err.message));

async function getSiteId(userId) {
  const { rows } = await db.query("SELECT id FROM sites WHERE user_id = $1", [userId]);
  return rows[0] ? rows[0].id : null;
}

function shape(row) {
  return {
    id: row.id,
    title: row.title,
    make: row.make,
    model: row.model,
    year: row.year,
    price: Number(row.price),
    condition: row.condition,
    mileage: row.mileage,
    transmission: row.transmission,
    fuel: row.fuel,
    color: row.color,
    location: row.location,
    status: row.status,
    description: row.description,
    photos: row.photos,
    createdAt: row.created_at,
  };
}

function cleanPhotos(value) {
  if (!Array.isArray(value)) return [];
  return value.map((p) => String(p || "").trim()).filter(isOurImage).slice(0, MAX_PHOTOS);
}

function readBody(body) {
  const make = String(body.make || "").trim().replace(/\s+/g, " ").slice(0, 30);
  const model = String(body.model || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!make) return { error: "Enter the make, for example Toyota" };
  if (!model) return { error: "Enter the model, for example Camry" };

  let year = null;
  if (body.year !== null && body.year !== undefined && body.year !== "") {
    year = Number(body.year);
    if (!Number.isInteger(year) || year < 1980 || year > new Date().getFullYear() + 1) {
      return { error: "Enter a real year" };
    }
  }

  const price = Number(body.price);
  if (!Number.isInteger(price) || price <= 0 || price > 100000000000) {
    return { error: "Enter a valid price" };
  }

  let mileage = null;
  if (body.mileage !== null && body.mileage !== undefined && body.mileage !== "") {
    mileage = Number(body.mileage);
    if (!Number.isInteger(mileage) || mileage < 0 || mileage > 3000000) {
      return { error: "Enter a valid mileage" };
    }
  }

  const location = String(body.location || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!location) return { error: "Enter where the car is" };

  // The title is built here too, so it can never be empty or junk
  const title = [year, make, model].filter(Boolean).join(" ");

  return {
    value: {
      title,
      make,
      model,
      year,
      price,
      condition: CONDITIONS.includes(body.condition) ? body.condition : "Foreign used",
      mileage,
      transmission: GEARS.includes(body.transmission) ? body.transmission : "Automatic",
      fuel: FUELS.includes(body.fuel) ? body.fuel : "Petrol",
      color: String(body.color || "").trim().slice(0, 20),
      location,
      status: STATUSES.includes(body.status) ? body.status : "Available",
      description: String(body.description || "").trim().slice(0, 1000),
      photos: cleanPhotos(body.photos),
    },
  };
}

router.get("/", requireAuth, async (req, res) => {
  await ready;
  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rows } = await db.query("SELECT * FROM cars WHERE site_id = $1 ORDER BY created_at DESC", [siteId]);
  res.json({ cars: rows.map(shape) });
});

// Above "/:id" so the word "inquiries" is never read as an id
router.get("/inquiries/all", requireAuth, async (req, res) => {
  await ready;
  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rows } = await db.query(
    `SELECT i.id, i.car_id, i.car_title, i.status, i.created_at, c.location, c.price
     FROM car_inquiries i
     LEFT JOIN cars c ON c.id = i.car_id
     WHERE i.site_id = $1
     ORDER BY i.created_at DESC
     LIMIT 200`,
    [siteId]
  );

  res.json({
    inquiries: rows.map((r) => ({
      id: r.id,
      carId: r.car_id,
      carTitle: r.car_title,
      status: r.status,
      location: r.location || "",
      price: r.price === null ? null : Number(r.price),
      createdAt: r.created_at,
    })),
  });
});

router.put("/inquiries/:id", requireAuth, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Inquiry not found" });
  const status = String(req.body.status || "");
  if (!INQUIRY_STATUSES.includes(status)) return res.status(400).json({ error: "Choose a valid status" });

  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rowCount } = await db.query(
    "UPDATE car_inquiries SET status = $1 WHERE id = $2 AND site_id = $3",
    [status, req.params.id, siteId]
  );
  if (!rowCount) return res.status(404).json({ error: "Inquiry not found" });
  res.json({ ok: true });
});

router.get("/:id", requireAuth, async (req, res) => {
  await ready;
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Car not found" });
  const siteId = await getSiteId(req.user.id);
  if (!siteId) return res.status(400).json({ error: "Set up your website first" });

  const { rows } = await db.query("SELECT * FROM cars WHERE id = $1 AND site_id = $2", [req.params.id, siteId]);
  if (!rows.length) return res.status(404).json({ error: "Car not found" });
  res.json({ car: shape(rows[0]) });
});

router.post("/", requireAuth, requireActive, async (req, res) => {
  await ready;
  const siteId = req.site.id;

  const { rows: countRows } = await db.query("SELECT COUNT(*)::int AS total FROM cars WHERE site_id = $1", [siteId]);
  if (countRows[0].total >= MAX_CARS) {
    return res.status(400).json({ error: `You have reached ${MAX_CARS} cars` });
  }

  const parsed = readBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const c = parsed.value;

  const { rows } = await db.query(
    `INSERT INTO cars
       (site_id, title, make, model, year, price, condition, mileage, transmission,
        fuel, color, location, status, description, photos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [siteId, c.title, c.make, c.model, c.year, c.price, c.condition, c.mileage, c.transmission,
     c.fuel, c.color, c.location, c.status, c.description, c.photos]
  );

  // The 24 hours start on the first car only. IS NULL means it can never restart.
  const { rows: trialRows } = await db.query(
    `UPDATE sites SET trial_ends_at = NOW() + INTERVAL '24 hours'
     WHERE id = $1 AND trial_ends_at IS NULL
     RETURNING trial_ends_at`,
    [siteId]
  );

  res.status(201).json({
    car: shape(rows[0]),
    trialStartedAt: trialRows.length ? trialRows[0].trial_ends_at : null,
  });
});

router.put("/:id", requireAuth, requireActive, async (req, res) => {
  await ready;
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Car not found" });

  const parsed = readBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const c = parsed.value;

  // site_id in the WHERE stops one dealer editing another dealer's car
  const { rows } = await db.query(
    `UPDATE cars
     SET title=$1, make=$2, model=$3, year=$4, price=$5, condition=$6, mileage=$7,
         transmission=$8, fuel=$9, color=$10, location=$11, status=$12,
         description=$13, photos=$14, updated_at=NOW()
     WHERE id=$15 AND site_id=$16
     RETURNING *`,
    [c.title, c.make, c.model, c.year, c.price, c.condition, c.mileage, c.transmission,
     c.fuel, c.color, c.location, c.status, c.description, c.photos, req.params.id, req.site.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Car not found" });
  res.json({ car: shape(rows[0]) });
});

router.delete("/:id", requireAuth, requireActive, async (req, res) => {
  await ready;
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Car not found" });
  const { rowCount } = await db.query("DELETE FROM cars WHERE id = $1 AND site_id = $2", [req.params.id, req.site.id]);
  if (!rowCount) return res.status(404).json({ error: "Car not found" });
  res.json({ ok: true });
});

// The public site needs the same "tables are ready" promise
router.ready = ready;
module.exports = router;