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

const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const RESEND_SECONDS = 60;

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

// Table for the 6-digit confirm codes. Safe to run every time.
db.query(
  `CREATE TABLE IF NOT EXISTS email_codes (
     id SERIAL PRIMARY KEY,
     user_id TEXT NOT NULL,
     code_hash TEXT NOT NULL,
     attempts INT NOT NULL DEFAULT 0,
     expires_at TIMESTAMPTZ NOT NULL,
     used_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`
).catch((err) => console.error("Could not create email_codes table:", err.message));

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "7d",
  });
}

function firstClientUrl() {
  return (process.env.CLIENT_URL || "http://localhost:3000").split(",")[0].trim();
}

// Only the hash of a code is stored, tied to the user and our secret,
// so a stolen database cannot be used to confirm anybody's email.
function hashCode(userId, code) {
  return crypto
    .createHmac("sha256", String(process.env.JWT_SECRET || ""))
    .update(`${userId}:${code}`)
    .digest("hex");
}

function codeEmail(code) {
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <h1 style="font-size:20px;margin:0 0 16px">Confirm your email</h1>
      <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 20px">
        Welcome to CBE QuickSite. Type this code in the app to confirm your email:
      </p>
      <p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:0 0 20px;color:#111">${code}</p>
      <p style="font-size:13px;line-height:1.6;color:#777;margin:0">
        This code works for ${CODE_MINUTES} minutes. If you did not create an account, you can ignore this email.
      </p>
      <p style="font-size:12px;color:#999;margin:24px 0 0">CBE QuickSite</p>
    </div>
  `;
}

// Saves a fresh 6-digit code and returns it. Older codes stop working.
async function makeCode(userId) {
  const uid = String(userId);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");

  await db.query("UPDATE email_codes SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL", [uid]);

  await db.query(
    `INSERT INTO email_codes (user_id, code_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '${CODE_MINUTES} minutes')`,
    [uid, hashCode(uid, code)]
  );

  return code;
}

function mailCode(email, code) {
  return send({
    to: email,
    subject: `${code} is your CBE QuickSite code`,
    html: codeEmail(code),
  });
}

async function sendCode(userId, email) {
  const code = await makeCode(userId);
  return mailCode(email, code);
}

// Slows down anyone guessing passwords over and over
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in 15 minutes." },
});

// Stricter: stops someone flooding a vendor's inbox with emails
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again in an hour." },
});

// For typing the 6-digit code (each code also locks after 5 wrong tries)
const codeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in 15 minutes." },
});

// For "Send again"
const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many codes requested. Try again in an hour." },
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

    // The code is saved BEFORE we reply, so the confirm screen always finds it.
    // Only the email itself is sent after the reply, so a slow mail server never holds up signup.
    let code = null;
    try {
      code = await makeCode(user.id);
    } catch (err) {
      console.error("Could not make confirm code:", err.message);
    }

    res.cookie("token", signToken(user), cookieOptions);
    res.status(201).json({ user });

    if (code) {
      mailCode(user.email, code).catch((err) => console.error("Confirm code email failed:", err.message));
    }
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
    // Getting into the inbox proves the address is real
    await client.query(
      "UPDATE users SET email_verified_at = NOW() WHERE id = $1 AND email_verified_at IS NULL",
      [reset.user_id]
    );
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

// Old confirm links (sent before the 6-digit code) still work
router.post("/verify-email", authLimiter, async (req, res) => {
  const token = String(req.body.token || "").trim();

  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return res.status(400).json({ error: "This link is no longer valid. Please ask for a new one." });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const { rows } = await db.query(
    `SELECT ev.id, ev.user_id, u.email, u.role
     FROM email_verifications ev
     JOIN users u ON u.id = ev.user_id
     WHERE ev.token_hash = $1 AND ev.used_at IS NULL AND ev.expires_at > NOW()`,
    [tokenHash]
  );
  if (!rows.length) {
    return res.status(400).json({ error: "This link is no longer valid. Please ask for a new one." });
  }

  const row = rows[0];

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE users SET email_verified_at = NOW() WHERE id = $1", [row.user_id]);
    await client.query("UPDATE email_verifications SET used_at = NOW() WHERE id = $1", [row.id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Sign them in, in case they opened the link on a different phone
  const user = { id: row.user_id, email: row.email, role: row.role };
  res.cookie("token", signToken(user), cookieOptions);
  res.json({ user });
});

// They typed the 6-digit code from their email
router.post("/verify-code", codeLimiter, requireAuth, async (req, res) => {
  const code = String(req.body.code || "").replace(/\D/g, "");
  if (code.length !== 6) {
    return res.status(400).json({ error: "Enter the 6-digit code" });
  }

  const uid = String(req.user.id);

  const { rows } = await db.query(
    `SELECT id, code_hash, attempts FROM email_codes
     WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [uid]
  );
  const row = rows[0];

  if (!row) {
    return res.status(400).json({ error: "This code has expired. Tap Send again." });
  }
  if (row.attempts >= MAX_TRIES) {
    return res.status(429).json({ error: "Too many wrong tries. Tap Send again for a new code." });
  }

  const real = Buffer.from(row.code_hash);
  const given = Buffer.from(hashCode(uid, code));
  const ok = real.length === given.length && crypto.timingSafeEqual(real, given);

  if (!ok) {
    await db.query("UPDATE email_codes SET attempts = attempts + 1 WHERE id = $1", [row.id]);
    const left = MAX_TRIES - (row.attempts + 1);
    return res.status(400).json({
      error:
        left > 0
          ? `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.`
          : "Too many wrong tries. Tap Send again for a new code.",
    });
  }

  // Burn the code and confirm the email together
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE email_codes SET used_at = NOW() WHERE id = $1", [row.id]);
    await client.query(
      "UPDATE users SET email_verified_at = NOW() WHERE id = $1 AND email_verified_at IS NULL",
      [req.user.id]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.json({ ok: true });
});

// "Send again" on the confirm screen.
// With { onlyIfNone: true } it only sends when they have no live code yet
// (accounts made before codes existed), and never replaces a code they already have.
router.post("/resend-verification", resendLimiter, requireAuth, async (req, res) => {
  const { rows } = await db.query(
    "SELECT id, email, email_verified_at FROM users WHERE id = $1",
    [req.user.id]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (user.email_verified_at) return res.json({ ok: true, alreadyVerified: true });

  const uid = String(user.id);

  if (req.body && req.body.onlyIfNone) {
    const live = await db.query(
      "SELECT 1 FROM email_codes WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW() LIMIT 1",
      [uid]
    );
    if (live.rows.length) return res.json({ ok: true, kept: true });
  }

  // One code per minute
  const last = await db.query(
    `SELECT EXTRACT(EPOCH FROM (NOW() - created_at))::int AS age
     FROM email_codes WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
    [uid]
  );
  if (last.rows.length && last.rows[0].age < RESEND_SECONDS) {
    return res.status(429).json({
      error: "Please wait a minute before asking again.",
      wait: RESEND_SECONDS - last.rows[0].age,
    });
  }

  await sendCode(user.id, user.email);
  res.json({ ok: true });
});

// The dashboard tells us when it is running from the home screen instead of
// a browser tab, so we know who has installed it and who still needs a nudge.
router.post("/installed", requireAuth, async (req, res) => {
  await db.query(
    "UPDATE users SET installed_at = NOW() WHERE id = $1 AND installed_at IS NULL",
    [req.user.id]
  );
  res.json({ ok: true });
});

// The dashboard calls this on every load to know who is signed in
router.get("/me", requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.role, u.email_verified_at, u.installed_at,
            s.id AS site_id, s.slug, s.business_name, s.business_type
     FROM users u
     LEFT JOIN sites s ON s.user_id = u.id
     WHERE u.id = $1`,
    [req.user.id]
  );

  const r = rows[0];
  if (!r) return res.status(401).json({ error: "Not signed in" });

  res.json({
    user: {
      id: r.id,
      email: r.email,
      role: r.role,
      emailVerified: !!r.email_verified_at,
      installed: !!r.installed_at,
    },
    site: r.site_id
      ? { id: r.site_id, slug: r.slug, businessName: r.business_name, businessType: r.business_type }
      : null,
  });
});

module.exports = router;