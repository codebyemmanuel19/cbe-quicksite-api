const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { send, layout } = require("../mail");

const router = express.Router();

const STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT Abuja", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina",
  "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau",
  "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
];
const DURATIONS = [3, 7, 14, 30];
const GOALS = ["visits", "messages"];
const MIN_BUDGET = 1000;
const MAX_BUDGET = 1000000;

function text(value, max) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

async function getSite(userId) {
  const { rows } = await db.query(
    `SELECT s.id, s.slug, s.business_name, u.email
     FROM sites s JOIN users u ON u.id = s.user_id WHERE s.user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

function shape(r) {
  return {
    id: r.id,
    businessType: r.business_type,
    states: r.states || [],
    dailyBudget: r.daily_budget,
    durationDays: r.duration_days,
    goal: r.goal,
    promote: r.promote,
    link: r.link,
    whatsapp: r.whatsapp,
    notes: r.notes,
    status: r.status,
    createdAt: r.created_at,
    submittedAt: r.submitted_at,
  };
}

// Reads what the page sent. `strict` is used when they finally send it to us.
function readBody(body, strict) {
  const states = [...new Set((Array.isArray(body.states) ? body.states : []).map(String))].filter((s) =>
    STATES.includes(s)
  );
  const dailyBudget = Math.round(Number(body.dailyBudget)) || 0;
  const durationDays = DURATIONS.includes(Number(body.durationDays)) ? Number(body.durationDays) : 7;

  const value = {
    business_type: text(body.businessType, 60),
    states,
    daily_budget: Math.min(Math.max(dailyBudget, 0), MAX_BUDGET),
    duration_days: durationDays,
    goal: GOALS.includes(body.goal) ? body.goal : "visits",
    promote: text(body.promote, 200),
    link: text(body.link, 200),
    whatsapp: text(body.whatsapp, 20).replace(/[^\d+]/g, ""),
    notes: text(body.notes, 500),
  };

  if (strict) {
    if (!value.business_type) return { error: "Tell us what type of business you run" };
    if (!value.states.length) return { error: "Select at least one state" };
    if (value.daily_budget < MIN_BUDGET) return { error: `Daily budget starts from ₦${MIN_BUDGET.toLocaleString("en-NG")}` };
    if (value.whatsapp.replace(/\D/g, "").length < 10) return { error: "Enter the WhatsApp number where customers will message you" };
  }
  return { value };
}

// Everything they saved or sent
router.get("/", requireAuth, async (req, res) => {
  const site = await getSite(req.user.id);
  if (!site) return res.status(400).json({ error: "Set up your website first" });

  const { rows } = await db.query("SELECT * FROM ad_requests WHERE site_id = $1 ORDER BY created_at DESC LIMIT 50", [
    site.id,
  ]);
  const draft = rows.find((r) => r.status === "draft");
  res.json({
    draft: draft ? shape(draft) : null,
    requests: rows.filter((r) => r.status !== "draft").map(shape),
    states: STATES,
  });
});

// Save as draft: one draft per website, so they can continue later
router.put("/draft", requireAuth, async (req, res) => {
  const site = await getSite(req.user.id);
  if (!site) return res.status(400).json({ error: "Set up your website first" });

  const { value: d } = readBody(req.body, false);
  const args = [d.business_type, d.states, d.daily_budget, d.duration_days, d.goal, d.promote, d.link, d.whatsapp, d.notes];

  const upd = await db.query(
    `UPDATE ad_requests SET business_type=$1, states=$2, daily_budget=$3, duration_days=$4, goal=$5,
            promote=$6, link=$7, whatsapp=$8, notes=$9, updated_at=NOW()
     WHERE site_id=$10 AND status='draft' RETURNING *`,
    [...args, site.id]
  );
  if (upd.rows.length) return res.json({ draft: shape(upd.rows[0]) });

  const { rows } = await db.query(
    `INSERT INTO ad_requests (business_type, states, daily_budget, duration_days, goal, promote, link, whatsapp, notes, site_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [...args, site.id]
  );
  res.status(201).json({ draft: shape(rows[0]) });
});

router.delete("/draft", requireAuth, async (req, res) => {
  const site = await getSite(req.user.id);
  if (!site) return res.status(400).json({ error: "Set up your website first" });
  await db.query("DELETE FROM ad_requests WHERE site_id = $1 AND status = 'draft'", [site.id]);
  res.json({ ok: true });
});

// Send it to us
router.post("/submit", requireAuth, async (req, res) => {
  const site = await getSite(req.user.id);
  if (!site) return res.status(400).json({ error: "Set up your website first" });

  const { value: d, error } = readBody(req.body, true);
  if (error) return res.status(400).json({ error });
  if (req.body.agreed !== true) return res.status(400).json({ error: "Please tick the box to confirm you understand" });

  // Stops one person filling our list with requests
  const recent = await db.query(
    "SELECT COUNT(*)::int AS n FROM ad_requests WHERE site_id = $1 AND status <> 'draft' AND submitted_at > NOW() - INTERVAL '24 hours'",
    [site.id]
  );
  if (recent.rows[0].n >= 3) return res.status(429).json({ error: "You have sent a few requests today. We will contact you soon." });

  const args = [d.business_type, d.states, d.daily_budget, d.duration_days, d.goal, d.promote, d.link, d.whatsapp, d.notes];
  const upd = await db.query(
    `UPDATE ad_requests SET business_type=$1, states=$2, daily_budget=$3, duration_days=$4, goal=$5,
            promote=$6, link=$7, whatsapp=$8, notes=$9, status='submitted', submitted_at=NOW(), updated_at=NOW()
     WHERE site_id=$10 AND status='draft' RETURNING *`,
    [...args, site.id]
  );
  let row = upd.rows[0];
  if (!row) {
    const ins = await db.query(
      `INSERT INTO ad_requests (business_type, states, daily_budget, duration_days, goal, promote, link, whatsapp, notes, site_id, status, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'submitted',NOW()) RETURNING *`,
      [...args, site.id]
    );
    row = ins.rows[0];
  }

  // Tell the admin. A failed email never stops the request being saved.
  const adminEmail = String(process.env.ADMIN_EMAIL || "").trim();
  if (adminEmail) {
    const total = d.daily_budget * d.duration_days;
    const esc = (v) => String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    send({
      to: adminEmail,
      subject: `New ad request: ${site.business_name}`,
      html: layout({
        title: "New ad request",
        badge: site.business_name,
        paras: [
          `<b>Business type:</b> ${esc(d.business_type)}`,
          `<b>States (${d.states.length}):</b> ${esc(d.states.join(", "))}`,
          `<b>Setup fee to collect:</b> ₦2,900`,
          `<b>Daily budget:</b> ₦${d.daily_budget.toLocaleString("en-NG")} for ${d.duration_days} days (₦${total.toLocaleString("en-NG")} paid to Meta)`,
          `<b>Goal:</b> ${d.goal === "messages" ? "More WhatsApp messages" : "More website visits"}`,
          `<b>Promote:</b> ${esc(d.promote || "Whole website")}<br><b>Link:</b> ${esc(d.link)}`,
          `<b>WhatsApp:</b> ${esc(d.whatsapp)}<br><b>Account email:</b> ${esc(site.email)}`,
          d.notes ? `<b>Notes:</b> ${esc(d.notes)}` : "",
        ].filter(Boolean),
      }),
    }).catch(() => {});
  }

  res.status(201).json({ request: shape(row) });
});

module.exports = router;