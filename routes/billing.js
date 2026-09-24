const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { billingStatus } = require("../middleware/locked");
const { PLANS } = require("../plans");
const { creditPayment } = require("../credit");

const router = express.Router();

function firstClientUrl() {
  return (process.env.CLIENT_URL || "http://localhost:3000").split(",")[0].trim();
}

// A stray space or quote mark in .env breaks the header without saying why
function secretKey() {
  return String(process.env.PAYSTACK_SECRET_KEY || "").trim().replace(/^["']|["']$/g, "");
}

async function loadSite(userId) {
  const { rows } = await db.query("SELECT * FROM sites WHERE user_id = $1", [userId]);
  return rows[0] || null;
}

function daysLeft(site) {
  const end = site.paid_until || site.trial_ends_at;
  if (!end) return null;
  return Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000));
}

// The browser reads prices from here. It never sends an amount.
router.get("/plans", (req, res) => {
  res.json({ plans: Object.values(PLANS) });
});

router.get("/status", requireAuth, async (req, res) => {
  const site = await loadSite(req.user.id);
  if (!site) return res.status(400).json({ error: "Set up your shop first" });

  const { rows: history } = await db.query(
    `SELECT reference, months, amount, currency, status, paid_until, created_at
     FROM payments WHERE site_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [site.id]
  );

  res.json({
    billing: {
      status: billingStatus(site),
      daysLeft: daysLeft(site),
      trialEndsAt: site.trial_ends_at,
      paidUntil: site.paid_until,
    },
    plans: Object.values(PLANS),
    history,
  });
});

router.post("/initialize", requireAuth, async (req, res) => {
  const plan = PLANS[String(req.body.plan || "")];
  if (!plan) return res.status(400).json({ error: "Choose a plan" });

  const site = await loadSite(req.user.id);
  if (!site) return res.status(400).json({ error: "Set up your shop first" });
  if (site.is_suspended) return res.status(403).json({ error: "This account is on hold. Please contact support." });

  if (!secretKey()) {
    console.error("PAYSTACK_SECRET_KEY is missing from .env");
    return res.status(500).json({ error: "Payments are not set up yet." });
  }

  const { rows: userRows } = await db.query("SELECT email FROM users WHERE id = $1", [req.user.id]);
  const email = userRows[0].email;

  const reference = "CBE-" + crypto.randomBytes(12).toString("hex");

  await db.query(
    `INSERT INTO payments (site_id, reference, months, amount, currency, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')`,
    [site.id, reference, plan.months, plan.amount, site.currency]
  );

  let paystack;
  let body;

  try {
    paystack = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: plan.amount * 100, // kobo, worked out here and nowhere else
        currency: site.currency || "NGN",
        reference,
        channels: ["card", "bank_transfer", "ussd"],
        callback_url: `${firstClientUrl()}/dashboard/billing?reference=${reference}`,
        metadata: { siteId: site.id, slug: site.slug, plan: plan.id },
      }),
    });

    body = await paystack.json();
  } catch (err) {
    console.error("Paystack unreachable:", err.message);
    await db.query("UPDATE payments SET status = 'failed' WHERE reference = $1", [reference]);
    return res.status(502).json({ error: "Could not reach the payment service. Check your internet." });
  }

  if (!body.status || !body.data) {
    console.error("Paystack refused:", paystack.status, JSON.stringify(body));
    await db.query("UPDATE payments SET status = 'failed' WHERE reference = $1", [reference]);
    return res.status(502).json({
      error: "Could not start the payment. Please try again.",
      // Only on your laptop, so you can see what Paystack actually said
      detail: process.env.NODE_ENV === "production" ? undefined : body.message,
    });
  }

  res.json({ reference, authorizationUrl: body.data.authorization_url, plan });
});

// The dashboard calls this when Paystack sends the vendor back
router.post("/verify", requireAuth, async (req, res) => {
  const reference = String(req.body.reference || "").trim().slice(0, 100);

  // The payment must belong to this vendor's own shop
  const { rows } = await db.query(
    `SELECT p.id FROM payments p JOIN sites s ON s.id = p.site_id
     WHERE p.reference = $1 AND s.user_id = $2`,
    [reference, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Payment not found" });

  const result = await creditPayment(reference);
  const site = await loadSite(req.user.id);

  if (!result.ok) return res.status(400).json({ error: result.error });

  res.json({
    ok: true,
    billing: {
      status: billingStatus(site),
      daysLeft: daysLeft(site),
      paidUntil: site.paid_until,
    },
  });
});

module.exports = router;