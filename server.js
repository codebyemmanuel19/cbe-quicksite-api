require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const db = require("./db");

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

// Signup, login, logout, who am I
app.use("/auth", require("./routes/auth"));

// Link check, creating a shop, business info, order settings
app.use("/sites", require("./routes/sites"));

// Vendor's own categories and products
app.use("/categories", require("./routes/categories"));
app.use("/products", require("./routes/products"));

// Customer orders and the vendor's orders page
app.use("/orders", require("./routes/orders"));

// What a customer's browser loads
app.use("/public", require("./routes/public"));

// Plans, payments, days
app.use("/billing", require("./routes/billing"));

app.use("/uploads", require("./routes/uploads"));

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));