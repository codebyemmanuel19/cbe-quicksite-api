const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const isProd = process.env.NODE_ENV === "production";

// Only set a cookie domain once the API lives under cbequicksite.com.
// A server cannot set a cookie for a domain it does not answer from.
const cookieDomain = process.env.COOKIE_DOMAIN || "";

// The token sits in a cookie that JavaScript cannot read, so it cannot be stolen from the page
const cookieOptions = {
  httpOnly: true,
  sameSite: isProd ? "none" : "lax", // "none" lets the dashboard and the API be on different addresses
  secure: isProd, // "none" is only allowed over https
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  ...(cookieDomain ? { domain: cookieDomain } : {}),
};

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "7d",
  });
}

// Slows down anyone guessing passwords over and over
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in 15 minutes." },
});

router.post("/signup", authLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Enter a valid email" });
  }
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: "Password must be 8 characters or more" });
  }

  const hash = await bcrypt.hash(password, 12);

  try {
    const { rows } = await db.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, role",
      [email, hash]
    );
    const user = rows[0];
    res.cookie("token", signToken(user), cookieOptions);
    res.status(201).json({ user });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "That email already has an account" });
    }
    throw err;
  }
});

router.post("/login", authLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const { rows } = await db.query(
    "SELECT id, email, role, password_hash FROM users WHERE email = $1",
    [email]
  );
  const user = rows[0];

  // Same message either way, so nobody can discover which emails have accounts
  const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!ok) return res.status(401).json({ error: "Email or password is wrong" });

  res.cookie("token", signToken(user), cookieOptions);
  res.json({ user: { id: user.id, email: user.email, role: user.role } });
});

router.post("/logout", (req, res) => {
  res.clearCookie("token", cookieOptions);
  res.json({ ok: true });
});

// The dashboard calls this on every load to know who is signed in
router.get("/me", requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.role, s.id AS site_id, s.slug, s.business_name, s.business_type
     FROM users u
     LEFT JOIN sites s ON s.user_id = u.id
     WHERE u.id = $1`,
    [req.user.id]
  );

  const r = rows[0];
  if (!r) return res.status(401).json({ error: "Not signed in" });

  res.json({
    user: { id: r.id, email: r.email, role: r.role },
    site: r.site_id
      ? { id: r.site_id, slug: r.slug, businessName: r.business_name, businessType: r.business_type }
      : null,
  });
});

module.exports = router;