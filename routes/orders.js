const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { COUNTRIES } = require("../countries");

const router = express.Router();

const MAX_ITEMS = 20;
const MAX_QTY = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["new", "confirmed", "out", "paid", "delivered", "cancelled"];

// 5 per 10 minutes in production. Set ORDER_LIMIT in .env only on your laptop.
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.ORDER_LIMIT || 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many orders. Please try again shortly." },
});

function text(value, max) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function isOffline(site) {
  if (site.is_suspended) return true;
  const now = Date.now();
  const paid = site.paid_until ? new Date(site.paid_until).getTime() : 0;
  if (paid > now) return false;
  if (!site.trial_ends_at) return false;
  const trial = new Date(site.trial_ends_at).getTime();
  if (trial > now) return false;
  return now > Math.max(trial, paid) + 30 * 24 * 60 * 60 * 1000;
}

function shapeOrder(o) {
  return {
    id: o.id,
    orderNumber: o.order_number,
    customer: o.customer_name,
    phone: o.customer_phone,
    delivery: {
      type: o.delivery_type,
      area: o.delivery_area,
      address: o.delivery_address,
      fee: o.delivery_fee,
    },
    payment: o.payment_method,
    status: o.status,
    items: o.items,
    subtotal: o.subtotal,
    total: o.total,
    note: o.note,
    createdAt: o.created_at,
  };
}

// A customer places an order. Nothing about money is taken from the browser.
router.post("/:slug", orderLimiter, async (req, res) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  const body = req.body || {};

  // Hidden field no human can see. If it is filled, it is a bot.
  if (text(body.website, 100)) return res.status(201).json({ ok: true });

  const { rows: siteRows } = await db.query("SELECT * FROM sites WHERE slug = $1", [slug]);
  const site = siteRows[0];
  if (!site || isOffline(site)) return res.status(404).json({ error: "Shop not found" });

  const money = COUNTRIES[site.country] || COUNTRIES.NG;

  const name = text(body.name, 80);
  if (name.length < 2) return res.status(400).json({ error: "Enter your name" });
  if (/https?:\/\//i.test(name)) return res.status(400).json({ error: "Enter your name" });

  let phone = String(body.phone || "").replace(/\D/g, "");
  if (phone.startsWith("0")) phone = phone.slice(1);
  if (!phone.startsWith(money.dialCode)) phone = money.dialCode + phone;
  if (!/^[0-9]{8,15}$/.test(phone)) return res.status(400).json({ error: "Enter a valid phone number" });

  const payment = body.payment === "transfer" ? "transfer" : "pod";
  if (payment === "pod" && !site.pay_on_delivery) return res.status(400).json({ error: "This shop does not accept pay on delivery" });
  if (payment === "transfer" && !site.pay_before_delivery) return res.status(400).json({ error: "This shop does not accept transfer" });

  // Work out delivery, using only the shop's own saved areas and fees
  const wantsPickup = body.deliveryType === "pickup";
  let deliveryType = "delivery";
  let area = "";
  let address = "";
  let fee = 0;

  if (wantsPickup) {
    if (!site.offers_pickup) return res.status(400).json({ error: "This shop does not offer pickup" });
    deliveryType = "pickup";
  } else {
    if (!site.offers_delivery) return res.status(400).json({ error: "This shop does not deliver" });

    address = text(body.address, 300);
    if (address.length < 5) return res.status(400).json({ error: "Enter your delivery address" });

    const wanted = text(body.area, 60);
    const known = (site.delivery_areas || []).find((a) => a.name.toLowerCase() === wanted.toLowerCase());

    if (known) {
      area = known.name;
      fee = known.fee; // from the database, never from the browser
    } else {
      area = "Area not listed";
      fee = null; // the vendor will agree it on WhatsApp
    }
  }

  // Rebuild every line from the database
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
  if (!rawItems.length) return res.status(400).json({ error: "Your bag is empty" });

  const ids = [...new Set(rawItems.map((i) => String(i && i.id)).filter((id) => UUID.test(id)))];
  if (!ids.length) return res.status(400).json({ error: "Your bag is empty" });

  const { rows: products } = await db.query(
    "SELECT id, name, price, sizes, colors, sold_out FROM products WHERE site_id = $1 AND id = ANY($2::uuid[])",
    [site.id, ids]
  );

  const items = [];
  let subtotal = 0;

  for (const raw of rawItems) {
    const product = products.find((p) => p.id === String(raw && raw.id));
    if (!product) return res.status(400).json({ error: "One of the items is no longer available" });
    if (product.sold_out) return res.status(400).json({ error: `${product.name} is sold out` });

    const qty = Number(raw.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return res.status(400).json({ error: "Check the quantity" });

    const size = text(raw.size, 20);
    if (size && !product.sizes.includes(size)) return res.status(400).json({ error: `Choose a size for ${product.name}` });
    if (!size && product.sizes.length) return res.status(400).json({ error: `Choose a size for ${product.name}` });

    const color = text(raw.color, 20);
    if (color && !product.colors.includes(color)) return res.status(400).json({ error: `Choose a colour for ${product.name}` });
    if (!color && product.colors.length) return res.status(400).json({ error: `Choose a colour for ${product.name}` });

    subtotal += product.price * qty; // the shop's price, not the browser's
    items.push({ productId: product.id, name: product.name, price: product.price, qty, size, color });
  }

  const total = subtotal + (fee || 0);

  // One query: take the next order number and save the order together
  const { rows } = await db.query(
    `WITH next AS (
       UPDATE sites SET next_order_number = next_order_number + 1
       WHERE id = $1
       RETURNING next_order_number - 1 AS number
     )
     INSERT INTO orders (site_id, order_number, customer_name, customer_phone, delivery_type,
                         delivery_area, delivery_address, delivery_fee, payment_method,
                         items, subtotal, total, note)
     SELECT $1, next.number, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12
     FROM next
     RETURNING *`,
    [site.id, name, phone, deliveryType, area, address, fee, payment, JSON.stringify(items), subtotal, total, text(body.note, 500)]
  );

  const order = rows[0];

  // Pay on delivery, but this shop collects the delivery fee before dispatch
  const feeFirst =
    payment === "pod" && site.delivery_fee_first && deliveryType === "delivery" && fee > 0;

  // Bank details are released only now, after a real order exists
  const showBank = (payment === "transfer" || feeFirst) && site.account_number;

  res.status(201).json({
    order: shapeOrder(order),
    bank: showBank
      ? {
          bankName: site.bank_name,
          accountNumber: site.account_number,
          accountName: site.account_name,
          amount: feeFirst ? fee : total, // fee only, or the whole order
          payingFor: feeFirst ? "delivery" : "full",
        }
      : null,
    whatsapp: site.whatsapp,
  });
});

// The vendor's Orders page
router.get("/", requireAuth, async (req, res) => {
  const { rows: siteRows } = await db.query("SELECT id FROM sites WHERE user_id = $1", [req.user.id]);
  if (!siteRows.length) return res.status(400).json({ error: "Set up your shop first" });

  const { rows } = await db.query(
    "SELECT * FROM orders WHERE site_id = $1 ORDER BY order_number DESC LIMIT 200",
    [siteRows[0].id]
  );

  res.json({ orders: rows.map(shapeOrder) });
});

router.put("/:id/status", requireAuth, async (req, res) => {
  const { rows: siteRows } = await db.query("SELECT id FROM sites WHERE user_id = $1", [req.user.id]);
  if (!siteRows.length) return res.status(400).json({ error: "Set up your shop first" });
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Order not found" });

  const status = String(req.body.status || "");
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status" });

  const { rows } = await db.query(
    "UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 AND site_id = $3 RETURNING *",
    [status, req.params.id, siteRows[0].id]
  );
  if (!rows.length) return res.status(404).json({ error: "Order not found" });

  res.json({ order: shapeOrder(rows[0]) });
});

// When the area was not listed, the vendor types the agreed fee
router.put("/:id/fee", requireAuth, async (req, res) => {
  const { rows: siteRows } = await db.query("SELECT id FROM sites WHERE user_id = $1", [req.user.id]);
  if (!siteRows.length) return res.status(400).json({ error: "Set up your shop first" });
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Order not found" });

  const fee = Number(req.body.fee);
  if (!Number.isInteger(fee) || fee < 0 || fee > 10000000) return res.status(400).json({ error: "Enter a valid fee" });

  const { rows } = await db.query(
    `UPDATE orders SET delivery_fee = $1, total = subtotal + $1, updated_at = NOW()
     WHERE id = $2 AND site_id = $3
     RETURNING *`,
    [fee, req.params.id, siteRows[0].id]
  );
  if (!rows.length) return res.status(404).json({ error: "Order not found" });

  res.json({ order: shapeOrder(rows[0]) });
});

module.exports = router;