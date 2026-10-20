require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const db = require("./db");
const { requireVerified } = require("./middleware/auth");
const { requireActive, requireRoom } = require("./middleware/locked");

const app = express();

app.set("trust proxy", 1);
app.use(helmet());

// Paystack's webhook needs the untouched body to check the signature, so it comes first
app.post("/billing/webhook", express.raw({ type: "application/json" }), require("./routes/webhook"));

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// Only your own pages may call this API with cookies
const allowed = (process.env.CLIENT_URL || "").split(",").map((s) => s.trim()).filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // Postman, server to server
      if (allowed.includes(origin)) return callback(null, true);
      if (/^https:\/\/[a-z0-9-]+\.cbequicksite\.com$/.test(origin)) return callback(null, true); // vendor shops
      return callback(new Error("Not allowed"));
    },
    credentials: true,
  })
);

app.use(rateLimit({ windowMs: 60000, max: 100, standardHeaders: true, legacyHeaders: false }));

// After the free trial, an unpaid vendor can still look, but cannot add, change or delete.
// This is the real lock. The locked screen in the dashboard is only the friendly face of it.
function lockWrites(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  Promise.resolve(requireActive(req, res, next)).catch(next);
}

// Free vendors can add 3 items. The 4th needs a paid plan.
function limitFree(req, res, next) {
  requireRoom(req, res, next);
}

app.get("/", (req, res) => res.json({ ok: true, service: "CBE QuickSite API" }));

// Proves the API is alive and can reach the database
app.get("/health", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT NOW() AS time");
    res.json({ ok: true, database: "connected", time: rows[0].time });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, database: "not connected" });
  }
});

// Everything that builds or changes a shop needs a confirmed email (requireVerified),
// and changes also need a trial or a paid plan (lockWrites)
app.use("/properties", requireVerified, lockWrites, limitFree, require("./routes/properties"));
app.use("/cars", requireVerified, lockWrites, limitFree, require("./routes/cars"));
app.use("/dishes", requireVerified, lockWrites, limitFree, require("./routes/dishes"));
app.use("/furniture", requireVerified, lockWrites, limitFree, require("./routes/furniture"));

// Signup, login, logout, who am I, confirm code (these must work before confirming)
app.use("/auth", require("./routes/auth"));

// Link check, creating a shop, business info, order settings
app.use("/sites", requireVerified, require("./routes/sites"));

// Vendor's own categories and products
app.use("/categories", requireVerified, lockWrites, require("./routes/categories"));
app.use("/products", requireVerified, lockWrites, limitFree, require("./routes/products"));

// Customer orders and the vendor's orders page
app.use("/orders", requireVerified, require("./routes/orders"));

// What a customer's browser loads
app.use("/public", require("./routes/public"));

// Plans, payments, days
app.use("/billing", require("./routes/billing"));

app.use("/uploads", requireVerified, lockWrites, require("./routes/uploads"));

// Daily reminder emails, called by cron-job.org
app.use("/cron", require("./routes/cron"));

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));