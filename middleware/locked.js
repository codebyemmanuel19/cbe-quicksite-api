const db = require("../db");

// Works out where a shop stands from its dates alone
function billingStatus(site) {
  const now = Date.now();
  if (site.is_suspended) return "suspended";
  const paid = site.paid_until ? new Date(site.paid_until).getTime() : 0;
  if (paid > now) return "active";
  if (!site.trial_ends_at) return "trial_not_started";
  const trial = new Date(site.trial_ends_at).getTime();
  if (trial > now) return "trial";
  if (now > Math.max(trial, paid) + 30 * 24 * 60 * 60 * 1000) return "offline";
  return "locked";
}

// Editing stops when the trial ends. The shop stays live and orders keep coming in.
async function requireActive(req, res, next) {
  const { rows } = await db.query("SELECT * FROM sites WHERE user_id = $1", [req.user.id]);
  const site = rows[0];
  if (!site) return res.status(400).json({ error: "Set up your shop first" });

  const status = billingStatus(site);

  if (status === "suspended") {
    return res.status(403).json({ error: "This account is on hold. Please contact support.", status });
  }
  if (status === "locked" || status === "offline") {
    return res.status(402).json({ error: "Your free trial has ended. Choose a plan to keep editing.", status });
  }

  req.site = site;
  next();
}

module.exports = { requireActive, billingStatus };