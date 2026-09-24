const crypto = require("crypto");
const { creditPayment } = require("../credit");

// Paystack signs every webhook with your secret key. No signature, no entry.
module.exports = async function webhook(req, res) {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const sent = String(req.headers["x-paystack-signature"] || "");
  const expected = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY || "").update(raw).digest("hex");

  if (sent.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
    return res.sendStatus(401);
  }

  res.sendStatus(200); // answer immediately, Paystack does not wait

  try {
    const event = JSON.parse(raw.toString("utf8"));
    if (event.event === "charge.success" && event.data && event.data.reference) {
      await creditPayment(event.data.reference);
    }
  } catch (err) {
    console.error("webhook failed:", err);
  }
};