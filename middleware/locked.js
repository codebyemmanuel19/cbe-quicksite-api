const db = require("../db");

// Every vendor can add this many items (products, properties or cars) for free, forever.
const FREE_ITEMS = 3;

// How many days a website stays live after a paid plan ends, if the vendor has not renewed.
// After this, the website goes offline until they pay.
const OFFLINE_AFTER_DAYS = 7;

// Real estate websites start with this many free days and no limit on listings.
const TRIAL_DAYS = 30;

// Counts everything the vendor has added, across all site types
async function countItems(siteId) {
  const { rows } = await db.query(
    `SELECT ((SELECT COUNT(*) FROM products WHERE site_id = $1)
           + (SELECT COUNT(*) FROM properties WHERE site_id = $1)
           + (SELECT COUNT(*) FROM cars WHERE site_id = $1))::int AS total`,
    [siteId]
  );
  return rows[0].total;
}

// Works out where a shop stands from its dates and how many items it has.
//  free      = 3 items or fewer, no payment needed, never locked
//  active    = paid plan running
//  trial     = free trial running (30 days for real estate): add as many as you like
//  locked    = more than 3 items and the plan ended: cannot add or edit
//  offline   = locked for more than 7 days: website hidden
function billingStatus(site, items) {
  const now = Date.now();
  if (site.is_suspended) return "suspended";
  const paid = site.paid_until ? new Date(site.paid_until).getTime() : 0;
  if (paid > now) return "active";
  const trial = site.trial_ends_at ? new Date(site.trial_ends_at).getTime() : 0;
  if (trial > now) return "trial";
  if ((Number(items) || 0) <= FREE_ITEMS) return "free";
  const since = Math.max(trial, paid);
  if (since && now > since + OFFLINE_AFTER_DAYS * 24 * 60 * 60 * 1000) return "offline";
  return "locked";
}

// Loads the site and its status in one go
async function statusFor(site) {
  const items = await countItems(site.id);
  return { items, status: billingStatus(site, items) };
}

// Editing stops when a vendor with more than 3 items has no paid plan.
// The website stays live and orders keep coming in.
async function requireActive(req, res, next) {
  const { rows } = await db.query("SELECT * FROM sites WHERE user_id = $1", [req.user.id]);
  const site = rows[0];
  if (!site) return res.status(400).json({ error: "Set up your shop first" });

  const { items, status } = await statusFor(site);

  if (status === "suspended") {
    return res.status(403).json({ error: "This account is on hold. Please contact support.", status });
  }
  if (status === "locked" || status === "offline") {
    return res.status(402).json({ error: "Your plan has ended. Choose a plan to keep editing.", status });
  }

  req.site = site;
  req.items = items;
  req.billingStatus = status;
  next();
}

// Adding a new item (POST to "/") is only free up to FREE_ITEMS.
// Only a paid plan or a running free trial can go past it. Runs after requireActive.
function requireRoom(req, res, next) {
  if (req.method !== "POST" || req.path !== "/") return next();
  const open = req.billingStatus === "active" || req.billingStatus === "trial";
  if (!open && (req.items || 0) >= FREE_ITEMS) {
    return res.status(402).json({
      error: `You have used your ${FREE_ITEMS} free items. Choose a plan to add more.`,
      status: "limit",
    });
  }
  next();
}

module.exports = { requireActive, requireRoom, billingStatus, statusFor, countItems, FREE_ITEMS, OFFLINE_AFTER_DAYS, TRIAL_DAYS };