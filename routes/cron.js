const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { send, reminderEmail } = require("../mail");
const { COUNTRIES } = require("../countries");

const router = express.Router();

const DAY = 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 40;

// A paid plan is reminded at 5 days and at 1 day left.
// The 7 day free trial is reminded at 2 days and at 1 day left.
const PLAN_STAGES = [5, 1];
const TRIAL_STAGES = [2, 1];

// Remembers what each shop was already emailed about. Safe to run every time.
db.query("ALTER TABLE sites ADD COLUMN IF NOT EXISTS last_reminder TEXT").catch((err) =>
  console.error("Could not add last_reminder column:", err.message)
);

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
         AND (
           (s.paid_until > NOW() AND s.paid_until < NOW() + INTERVAL '5 days')
           OR ((s.paid_until IS NULL OR s.paid_until <= NOW())
               AND s.trial_ends_at > NOW() AND s.trial_ends_at < NOW() + INTERVAL '2 days')
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

      const stages = kind === "plan" ? PLAN_STAGES : TRIAL_STAGES;
      const stage = stages.filter((x) => daysLeft <= x).pop();
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
        subject: `Your ${what} ends in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`,
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

module.exports = router;