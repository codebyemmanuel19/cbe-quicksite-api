const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { send, reminderEmail } = require("../mail");
const { pick, buildEmail, unsubToken } = require("../lifecycle");
const { COUNTRIES } = require("../countries");

const router = express.Router();

const DAY = 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 40;
const MAX_LIFECYCLE_PER_RUN = 25;

// A paid plan is reminded at 5 days and at 1 day left.
// The free trial is short (24 hours), so it gets ONE reminder, 6 hours before it ends.
const PLAN_STAGES = [5, 1];
const TRIAL_REMIND_HOURS = 6;
const HOUR = 60 * 60 * 1000;

// Remembers what each shop was already emailed about. Safe to run every time.
db.query("ALTER TABLE sites ADD COLUMN IF NOT EXISTS last_reminder TEXT").catch((err) =>
  console.error("Could not add last_reminder column:", err.message)
);

// Tables for the journey emails. Safe to run every time.
const lifecycleReady = (async () => {
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ");
  await db.query(
    `CREATE TABLE IF NOT EXISTS email_log (
       id SERIAL PRIMARY KEY,
       user_id TEXT NOT NULL,
       key TEXT NOT NULL,
       sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (user_id, key)
     )`
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS lifecycle_meta (
       key TEXT PRIMARY KEY,
       started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
})().catch((err) => console.error("Lifecycle setup failed:", err.message));

function secretOk(req) {
  const secret = String(process.env.CRON_SECRET || "");
  if (secret.length < 16) return false; // not set up, so nobody gets in

  const given = Buffer.from(String(req.get("x-cron-secret") || ""));
  const real = Buffer.from(secret);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function appUrl() {
  return (process.env.CLIENT_URL || "").split(",")[0].trim() || "https://cbequicksite.com";
}

// POST /cron/reminders  (header: x-cron-secret)
// Add ?dry=1 to see who would get an email, without sending anything.
router.post("/reminders", async (req, res) => {
  if (!secretOk(req)) return res.status(404).json({ error: "Not found" });

  try {
    const dry = req.query.dry === "1";
    const now = Date.now();

    // Only shops whose plan or trial ends soon. The exact day check happens below.
    const { rows } = await db.query(
      `SELECT s.id, s.business_name, s.country, s.currency, s.paid_until, s.trial_ends_at,
              s.last_reminder, u.email AS owner_email,
              (SELECT COUNT(*) FROM orders o
                WHERE o.site_id = s.id AND o.status <> 'cancelled'
                  AND o.created_at > NOW() - INTERVAL '30 days')::int AS orders_count,
              (SELECT COALESCE(SUM(o.total), 0) FROM orders o
                WHERE o.site_id = s.id AND o.status <> 'cancelled'
                  AND o.created_at > NOW() - INTERVAL '30 days')::bigint AS orders_total
       FROM sites s
       JOIN users u ON u.id = s.user_id
       WHERE s.is_suspended IS NOT TRUE
         AND u.email_verified_at IS NOT NULL
         AND (
           (s.paid_until > NOW() AND s.paid_until < NOW() + INTERVAL '5 days')
           OR ((s.paid_until IS NULL OR s.paid_until <= NOW())
               AND s.trial_ends_at > NOW() AND s.trial_ends_at < NOW() + INTERVAL '6 hours')
         )
       LIMIT 200`
    );

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const wouldSend = [];

    for (const s of rows) {
      const paidActive = s.paid_until && new Date(s.paid_until).getTime() > now;
      const kind = paidActive ? "plan" : "trial";
      const end = new Date(paidActive ? s.paid_until : s.trial_ends_at);
      const daysLeft = Math.ceil((end.getTime() - now) / DAY);

      let stage;
      if (kind === "plan") {
        stage = PLAN_STAGES.filter((x) => daysLeft <= x).pop();
      } else {
        const hoursLeft = (end.getTime() - now) / HOUR;
        stage = hoursLeft <= TRIAL_REMIND_HOURS ? TRIAL_REMIND_HOURS : undefined;
      }
      if (!stage || !s.owner_email) {
        skipped++;
        continue;
      }

      // Same plan end date and same stage: already emailed
      const key = `${kind}:${stage}:${end.toISOString()}`;
      if (s.last_reminder === key) {
        skipped++;
        continue;
      }

      if (dry) {
        wouldSend.push({ shop: s.business_name, kind, daysLeft });
        continue;
      }
      if (sent >= MAX_PER_RUN) break;

      // Claim it first, so two runs at the same time can never send twice
      const claim = await db.query(
        "UPDATE sites SET last_reminder = $1 WHERE id = $2 AND last_reminder IS DISTINCT FROM $1 RETURNING id",
        [key, s.id]
      );
      if (!claim.rows.length) {
        skipped++;
        continue;
      }

      const money = COUNTRIES[s.country] || COUNTRIES.NG || {};
      const symbol = money.symbol || `${s.currency || ""} `;
      const what = kind === "plan" ? "plan" : "free trial";

      const result = await send({
        to: s.owner_email,
        subject:
          kind === "plan"
            ? `Your ${what} ends in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`
            : "Your free trial ends in a few hours",
        html: reminderEmail({
          name: s.business_name,
          kind,
          daysLeft,
          orders: Number(s.orders_count) || 0,
          total: Number(s.orders_total) || 0,
          symbol,
          link: `${appUrl()}/dashboard/billing`,
        }),
      });

      if (result.ok) {
        sent++;
      } else {
        failed++;
        // Put it back so tomorrow's run tries again
        await db.query("UPDATE sites SET last_reminder = $1 WHERE id = $2", [s.last_reminder, s.id]);
      }

      await sleep(600); // Resend allows only a couple of emails per second
    }

    res.json({ ok: true, checked: rows.length, sent, skipped, failed, wouldSend: dry ? wouldSend : undefined });
  } catch (err) {
    console.error("Reminder job failed:", err);
    res.status(500).json({ ok: false, error: "Reminder job failed" });
  }
});

// Only people who signed up after this moment get the journey emails,
// so turning it on never floods old accounts. Set LIFECYCLE_FROM (a date like
// 2026-10-09) to choose your own start.
async function lifecycleFrom() {
  const fromEnv = String(process.env.LIFECYCLE_FROM || "").trim();
  if (fromEnv && !Number.isNaN(Date.parse(fromEnv))) return new Date(fromEnv);

  await db.query("INSERT INTO lifecycle_meta (key) VALUES ('lifecycle') ON CONFLICT (key) DO NOTHING");
  const { rows } = await db.query("SELECT started_at FROM lifecycle_meta WHERE key = 'lifecycle'");
  return new Date(rows[0].started_at);
}

// POST /cron/lifecycle  (header: x-cron-secret)  Run it every 10 minutes.
// Add ?dry=1 to see who would get an email, without sending anything.
router.post("/lifecycle", async (req, res) => {
  if (!secretOk(req)) return res.status(404).json({ error: "Not found" });

  try {
    await lifecycleReady;

    const dry = req.query.dry === "1";
    const now = Date.now();
    const from = await lifecycleFrom();
    const apiBase = `https://${req.get("host")}`;

    const { rows } = await db.query(
      `SELECT u.id, u.email, u.created_at, u.installed_at,
              s.id AS site_id, s.slug, s.business_name, s.business_type,
              s.trial_ends_at, s.paid_until,
              ((SELECT COUNT(*) FROM products p WHERE p.site_id = s.id)
               + (SELECT COUNT(*) FROM properties r WHERE r.site_id = s.id))::int AS items,
              COALESCE((SELECT array_agg(l.key) FROM email_log l WHERE l.user_id = u.id::text), '{}') AS sent,
              (SELECT MAX(l.sent_at) FROM email_log l WHERE l.user_id = u.id::text) AS last_sent
       FROM users u
       LEFT JOIN sites s ON s.user_id = u.id
       WHERE u.unsubscribed_at IS NULL
         AND u.email_verified_at IS NOT NULL
         AND u.created_at >= $1
         AND (s.id IS NULL OR s.is_suspended IS NOT TRUE)
       ORDER BY u.created_at ASC
       LIMIT 500`,
      [from]
    );

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const wouldSend = [];

    for (const u of rows) {
      const key = pick(u, now);
      if (!key) {
        skipped++;
        continue;
      }

      if (dry) {
        wouldSend.push({ email: u.email, key });
        continue;
      }
      if (sent >= MAX_LIFECYCLE_PER_RUN) break;

      const mail = buildEmail(key, {
        name: u.business_name,
        businessType: u.business_type,
        hasSite: !!u.site_id,
        app: appUrl(),
        unsubUrl: `${apiBase}/cron/unsubscribe?u=${encodeURIComponent(u.id)}&t=${unsubToken(u.id)}`,
      });
      if (!mail) {
        skipped++;
        continue;
      }

      // Claim it first, so two runs at the same time can never send twice
      const claim = await db.query(
        "INSERT INTO email_log (user_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id",
        [String(u.id), key]
      );
      if (!claim.rows.length) {
        skipped++;
        continue;
      }

      const result = await send({ to: u.email, subject: mail.subject, html: mail.html });
      if (result.ok) {
        sent++;
      } else {
        failed++;
        // Remove the claim so the next run tries again
        await db.query("DELETE FROM email_log WHERE user_id = $1 AND key = $2", [String(u.id), key]);
      }

      await sleep(600); // Resend allows only a couple of emails per second
    }

    res.json({
      ok: true,
      checked: rows.length,
      sent,
      skipped,
      failed,
      wouldSend: dry ? wouldSend : undefined,
    });
  } catch (err) {
    console.error("Lifecycle job failed:", err);
    res.status(500).json({ ok: false, error: "Lifecycle job failed" });
  }
});

// The link at the bottom of every journey email
router.get("/unsubscribe", async (req, res) => {
  const id = String(req.query.u || "");
  const token = String(req.query.t || "");

  const page = (text) =>
    res.type("html").send(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
       <body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:60px auto;padding:0 20px;color:#111">
       <h2>${text}</h2><p style="color:#555">CBE QuickSite</p></body>`
    );

  const real = Buffer.from(unsubToken(id));
  const given = Buffer.from(token);
  if (!id || real.length !== given.length || !crypto.timingSafeEqual(real, given)) {
    return page("This link is not valid.");
  }

  await db.query("UPDATE users SET unsubscribed_at = NOW() WHERE id::text = $1 AND unsubscribed_at IS NULL", [id]);
  page("You have been unsubscribed.");
});

module.exports = router;