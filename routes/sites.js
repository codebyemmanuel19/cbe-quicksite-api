const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireActive } = require("../middleware/locked");
const { isOurImage } = require("../images");
const { COUNTRIES } = require("../countries");

const router = express.Router();

const RESERVED = ["www", "app", "api", "admin", "dashboard", "mail", "support", "login", "signup"];
const TYPES = ["clothing", "hair", "skincare", "perfume", "jewellery", "gadgets"];
const MAX_AREAS = 30;

function cleanSlug(value) {
  return String(value || "").trim().toLowerCase();
}

function slugProblem(slug) {
  if (slug.length < 3 || slug.length > 30) return "Link must be 3 to 30 characters";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) return "Use small letters, numbers and dashes only";
  if (RESERVED.includes(slug)) return "That link is not available";
  return null;
}

function text(value, max) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

// A social link may be a handle or a full link, but never javascript:, data: or anything odd
function link(value, max) {
  let v = String(value || "").trim().replace(/\s+/g, "").slice(0, max);
  if (!v) return "";
  if (v.startsWith("http://")) v = "https://" + v.slice(7);
  if (v.startsWith("https://")) return v.slice(0, max);
  if (v.includes(":")) return ""; // javascript:, data: and friends
  if (/^@?[A-Za-z0-9._-]+$/.test(v)) return v; // just a handle like @kemisboutique
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/[^\s]*)?$/.test(v)) return ("https://" + v).slice(0, max);
  return "";
}

// Logo and cover must also live in your own Cloudinary account
function imageUrl(value) {
  const v = String(value || "").trim().slice(0, 500);
  return isOurImage(v) ? v : "";
}

// Returns null when it is not a real email, so we can complain
function emailOrEmpty(value) {
  const v = String(value || "").trim().toLowerCase().slice(0, 100);
  if (!v) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

function normalisePhone(value, dialCode) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith(dialCode)) digits = dialCode + digits;
  return /^[0-9]{8,15}$/.test(digits) ? digits : null;
}

// trial, active, locked and offline all come from these dates, so no daily job is needed
function billingStatus(row) {
  const now = Date.now();
  if (row.is_suspended) return "suspended";
  const paid = row.paid_until ? new Date(row.paid_until).getTime() : 0;
  if (paid > now) return "active";
  if (!row.trial_ends_at) return "trial_not_started";
  const trial = new Date(row.trial_ends_at).getTime();
  if (trial > now) return "trial";
  const lockedSince = Math.max(trial, paid);
  if (now > lockedSince + 30 * 24 * 60 * 60 * 1000) return "offline";
  return "locked";
}

function daysLeft(row) {
  const end = row.paid_until || row.trial_ends_at;
  if (!end) return null;
  return Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000));
}

function shapeSite(s) {
  return {
    id: s.id,
    slug: s.slug,
    url: `https://${s.slug}.cbequicksite.com`,
    businessType: s.business_type,
    country: s.country,
    currency: s.currency,
    business: {
      businessName: s.business_name,
      heroLabel: s.hero_label,
      heroHeadline: s.hero_headline,
      about: s.about,
      logo: s.logo_url,
      cover: s.cover_url,
      whatsapp: s.whatsapp,
      phone: s.phone,
      email: s.email,
      address: s.address,
      tiktok: s.tiktok,
      facebook: s.facebook,
      instagram: s.instagram,
    },
    orderSettings: {
      payOnDelivery: s.pay_on_delivery,
      deliveryFeeFirst: s.delivery_fee_first,
      payBeforeDelivery: s.pay_before_delivery,
      bankName: s.bank_name,
      accountNumber: s.account_number,
      accountName: s.account_name,
      offersDelivery: s.offers_delivery,
      areas: s.delivery_areas,
      offersPickup: s.offers_pickup,
      pickupAddress: s.pickup_address,
      alertEmail: s.alert_email,
    },
    billing: {
      status: billingStatus(s),
      daysLeft: daysLeft(s),
      trialEndsAt: s.trial_ends_at,
      paidUntil: s.paid_until,
    },
  };
}

async function loadSite(userId) {
  const { rows } = await db.query("SELECT * FROM sites WHERE user_id = $1", [userId]);
  return rows[0] || null;
}

// The Setup page calls this while they type
router.get("/check-slug", async (req, res) => {
  const slug = cleanSlug(req.query.slug);

  const problem = slugProblem(slug);
  if (problem) return res.json({ available: false, reason: problem });

  const { rows } = await db.query("SELECT 1 FROM sites WHERE slug = $1", [slug]);
  if (rows.length) return res.json({ available: false, reason: "Someone already has that link" });

  res.json({ available: true, url: `https://${slug}.cbequicksite.com` });
});

// Everything the dashboard needs about the shop
router.get("/me", requireAuth, async (req, res) => {
  const site = await loadSite(req.user.id);
  if (!site) return res.status(404).json({ error: "No shop yet" });
  res.json({ site: shapeSite(site) });
});

router.post("/", requireAuth, async (req, res) => {
  const country = String(req.body.country || "").toUpperCase();
  const info = COUNTRIES[country];
  if (!info || !info.live) return res.status(400).json({ error: "We are not live in that country yet" });

  const type = String(req.body.businessType || "").toLowerCase();
  if (!TYPES.includes(type)) return res.status(400).json({ error: "Choose a business type" });

  const name = text(req.body.businessName, 50);
  if (name.length < 2) return res.status(400).json({ error: "Business name must be 2 to 50 characters" });

  const slug = cleanSlug(req.body.slug);
  const problem = slugProblem(slug);
  if (problem) return res.status(400).json({ error: problem });

  const whatsapp = normalisePhone(req.body.whatsapp, info.dialCode);
  if (!whatsapp) return res.status(400).json({ error: "Enter a valid WhatsApp number" });

  try {
    const { rows } = await db.query(
      `INSERT INTO sites (user_id, slug, business_type, country, currency, business_name, whatsapp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.user.id, slug, type, country, info.currency, name, whatsapp]
    );
    res.status(201).json({ site: shapeSite(rows[0]) });
  } catch (err) {
    if (err.code === "23505") {
      const where = String(err.constraint || err.detail || "");
      if (where.includes("user_id")) return res.status(409).json({ error: "You already have a site" });
      return res.status(409).json({ error: "Someone already has that link" });
    }
    throw err;
  }
});

// Business Info page. requireActive blocks editing once the trial has ended.
router.put("/business", requireAuth, requireActive, async (req, res) => {
  const site = req.site;

  const info = COUNTRIES[site.country] || COUNTRIES.NG;
  const b = req.body || {};

  const businessName = text(b.businessName, 50);
  if (businessName.length < 2) return res.status(400).json({ error: "Business name must be 2 to 50 characters" });

  const whatsapp = normalisePhone(b.whatsapp, info.dialCode);
  if (!whatsapp) return res.status(400).json({ error: "Enter a valid WhatsApp number" });

  const email = emailOrEmpty(b.email);
  if (email === null) return res.status(400).json({ error: "Enter a valid email or leave it empty" });

  const phone = String(b.phone || "").replace(/[^\d+\s-]/g, "").trim().slice(0, 20);

  const { rows } = await db.query(
    `UPDATE sites SET
       business_name = $1, hero_label = $2, hero_headline = $3, about = $4,
       logo_url = $5, cover_url = $6, whatsapp = $7, phone = $8, email = $9,
       address = $10, tiktok = $11, facebook = $12, instagram = $13, updated_at = NOW()
     WHERE id = $14
     RETURNING *`,
    [
      businessName,
      text(b.heroLabel, 30),
      text(b.heroHeadline, 40),
      String(b.about || "").trim().slice(0, 500),
      imageUrl(b.logo),
      imageUrl(b.cover),
      whatsapp,
      phone,
      email,
      text(b.address, 150),
      link(b.tiktok, 100),
      link(b.facebook, 100),
      link(b.instagram, 100),
      site.id,
    ]
  );

  res.json({ site: shapeSite(rows[0]) });
});

// Order Settings page. Also locked when the trial has ended.
router.put("/order-settings", requireAuth, requireActive, async (req, res) => {
  const site = req.site;

  const s = req.body || {};
  const payOnDelivery = s.payOnDelivery === true;
  const payBeforeDelivery = s.payBeforeDelivery === true;
  const offersDelivery = s.offersDelivery === true;
  const offersPickup = s.offersPickup === true;

  if (!payOnDelivery && !payBeforeDelivery) {
    return res.status(400).json({ error: "Choose at least one way customers can pay" });
  }
  if (!offersDelivery && !offersPickup) {
    return res.status(400).json({ error: "Turn on delivery or pickup so customers can receive their orders" });
  }

  let bankName = "";
  let accountNumber = "";
  let accountName = "";

  if (payBeforeDelivery) {
    bankName = text(s.bankName, 60);
    accountName = text(s.accountName, 100);
    accountNumber = String(s.accountNumber || "").replace(/\D/g, "").slice(0, 20);

    if (bankName.length < 2) return res.status(400).json({ error: "Enter your bank name" });
    if (accountName.length < 2) return res.status(400).json({ error: "Enter the account name" });

    const okLength = site.country === "NG" ? accountNumber.length === 10 : accountNumber.length >= 5;
    if (!okLength) return res.status(400).json({ error: "Enter a valid account number" });
  }

  // Areas and fees are cleaned here, because checkout will trust only these
  const areas = [];
  if (Array.isArray(s.areas)) {
    for (const item of s.areas) {
      const name = text(item && item.name, 40);
      const fee = Number(item && item.fee);
      if (!name) continue;
      if (!Number.isInteger(fee) || fee < 0 || fee > 10000000) {
        return res.status(400).json({ error: `Enter a valid fee for ${name}` });
      }
      if (areas.some((a) => a.name.toLowerCase() === name.toLowerCase())) continue;
      areas.push({ name, fee });
      if (areas.length >= MAX_AREAS) break;
    }
  }

  if (offersDelivery && areas.length === 0) {
    return res.status(400).json({ error: "Add at least one delivery area and its fee" });
  }

  const pickupAddress = text(s.pickupAddress, 150);
  if (offersPickup && pickupAddress.length < 5) {
    return res.status(400).json({ error: "Enter the address customers should come to" });
  }

  const alertEmail = emailOrEmpty(s.alertEmail);
  if (alertEmail === null) return res.status(400).json({ error: "Enter a valid alert email or leave it empty" });

  const { rows } = await db.query(
    `UPDATE sites SET
       pay_on_delivery = $1, delivery_fee_first = $2, pay_before_delivery = $3,
       bank_name = $4, account_number = $5, account_name = $6,
       offers_delivery = $7, delivery_areas = $8, offers_pickup = $9,
       pickup_address = $10, alert_email = $11, updated_at = NOW()
     WHERE id = $12
     RETURNING *`,
    [
      payOnDelivery,
      s.deliveryFeeFirst === true,
      payBeforeDelivery,
      bankName,
      accountNumber,
      accountName,
      offersDelivery,
      JSON.stringify(areas),
      offersPickup,
      pickupAddress,
      alertEmail,
      site.id,
    ]
  );

  res.json({ site: shapeSite(rows[0]) });
});

module.exports = router;