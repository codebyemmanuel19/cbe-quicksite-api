const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { send, resetEmail } = require("../mail");

const router = express.Router();
const isProd = process.env.NODE_ENV === "production";

// Only set a cookie domains once the API lives under cbequicksite.com.
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

function firstClientUrl() {
  return (process.env.CLIENT_URL || "http://localhost:3000").split(",")[0].trim();
}

// Slows down anyone guessing passwords over and over
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in 15 minutes." },
});

// Stricter: stops someone flooding a vendor's inbox with reset emails
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again in an hour." },
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

// Step 1: the vendor asks for a reset link
router.post("/forgot-password", resetLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();

  // Always the same answer, whether or not the email exists.
  // Otherwise this page becomes a way to find out who has an account.
  const done = { ok: true };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json(done);

  const { rows } = await db.query("SELECT id FROM users WHERE email = $1", [email]);
  if (!rows.length) return res.json(done);

  const userId = rows[0].id;

  // One live link at a time: asking again kills the older ones
  await db.query(
    "UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL",
    [userId]
  );

  // The plain code goes in the email. Only its hash is stored, so a stolen
  // database still cannot be used to reset anybody's password.
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  await db.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
    [userId, tokenHash]
  );

  const link = `${firstClientUrl()}/reset-password?token=${token}`;
  await send({
    to: email,
    subject: "Reset your CBE QuickSite password",
    html: resetEmail(link),
  });

  res.json(done);
});

// Step 2: they click the link and choose a new password
router.post("/reset-password", authLimiter, async (req, res) => {
  const token = String(req.body.token || "").trim();
  const password = String(req.body.password || "");

  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: "Password must be 8 characters or more" });
  }
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return res.status(400).json({ error: "This link is no longer valid. Please ask for a new one." });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  // Must exist, be unused, and still be inside the hour
  const { rows } = await db.query(
    `SELECT pr.id, pr.user_id, u.email, u.role
     FROM password_resets pr
     JOIN users u ON u.id = pr.user_id
     WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > NOW()`,
    [tokenHash]
  );
  if (!rows.length) {
    return res.status(400).json({ error: "This link is no longer valid. Please ask for a new one." });
  }

  const reset = rows[0];
  const hash = await bcrypt.hash(password, 12);

  // Change the password and burn the link together, so it can never be reused
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, reset.user_id]);
    await client.query("UPDATE password_resets SET used_at = NOW() WHERE id = $1", [reset.id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Sign them straight in, so they never have to type it twice
  const user = { id: reset.user_id, email: reset.email, role: reset.role };
  res.cookie("token", signToken(user), cookieOptions);
  res.json({ user });
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