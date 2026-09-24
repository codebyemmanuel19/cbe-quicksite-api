const db = require("./db");
const { PLANS } = require("./plans");

async function askPaystack(reference) {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  const body = await res.json();
  return body && body.data ? body.data : null;
}

// Safe to call twice (once from the browser, once from the webhook).
// The row is locked and only a pending payment is ever credited, so days can never double.
async function creditPayment(reference) {
  const data = await askPaystack(reference);
  if (!data || data.status !== "success") return { ok: false, error: "Payment not successful" };

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query("SELECT * FROM payments WHERE reference = $1 FOR UPDATE", [reference]);
    const payment = rows[0];

    if (!payment) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Unknown payment" };
    }
    if (payment.status === "success") {
      await client.query("ROLLBACK");
      return { ok: true, alreadyDone: true };
    }

    const plan = Object.values(PLANS).find((p) => p.months === payment.months);
    if (!plan) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Unknown plan" };
    }

    // What Paystack actually collected must match our own price, in kobo
    if (Number(data.amount) !== plan.amount * 100 || String(data.currency) !== payment.currency) {
      await client.query("UPDATE payments SET status = 'failed', verified_at = NOW() WHERE id = $1", [payment.id]);
      await client.query("COMMIT");
      return { ok: false, error: "Amount does not match the plan" };
    }

    // New days stack on top of whatever is left
    const { rows: siteRows } = await client.query(
      `UPDATE sites
       SET paid_until = GREATEST(COALESCE(paid_until, NOW()), NOW()) + ($1 || ' days')::interval,
           updated_at = NOW()
       WHERE id = $2
       RETURNING paid_until`,
      [String(plan.days), payment.site_id]
    );

    await client.query(
      "UPDATE payments SET status = 'success', verified_at = NOW(), paid_until = $1 WHERE id = $2",
      [siteRows[0].paid_until, payment.id]
    );

    await client.query("COMMIT");
    return { ok: true, days: plan.days, paidUntil: siteRows[0].paid_until };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { creditPayment };