// One place for every email we send. If Resend is not set up,
// nothing crashes: the email is skipped and the app keeps working.
const FROM = process.env.MAIL_FROM || "onboarding@resend.dev";

async function send({ to, subject, html }) {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key) {
    console.warn("No RESEND_API_KEY, email not sent:", subject);
    return { ok: false, error: "Email is not set up" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: `CBE QuickSite <${FROM}>`, to, subject, html }),
    });

    const body = await res.json();
    if (!res.ok) {
      console.error("Resend refused:", res.status, body);
      return { ok: false, error: body.message || "Email failed" };
    }

    return { ok: true, id: body.id };
  } catch (err) {
    console.error("Could not reach Resend:", err.message);
    return { ok: false, error: "Email failed" };
  }
}

// Business names come from users, so never put them into HTML as they are
function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Plain, short and mobile-friendly. Long HTML emails land in spam.
function resetEmail(link) {
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <h1 style="font-size:20px;margin:0 0 16px">Reset your password</h1>
      <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 24px">
        Tap the button below to choose a new password. This link works once and expires in 1 hour.
      </p>
      <a href="${link}"
         style="display:inline-block;padding:14px 28px;background:#1d4ed8;color:#fff;
                text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">
        Reset password
      </a>
      <p style="font-size:13px;line-height:1.6;color:#777;margin:24px 0 0">
        If you did not ask for this, you can ignore this email. Your password stays the same.
      </p>
      <p style="font-size:12px;color:#999;margin:24px 0 0">CBE QuickSite</p>
    </div>
  `;
}

// Sent the moment someone signs up
function verifyEmail(link) {
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <h1 style="font-size:20px;margin:0 0 16px">Confirm your email</h1>
      <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 24px">
        Welcome to CBE QuickSite. Tap the button below so we know this email is really yours.
        That way you can always get back into your account.
      </p>
      <a href="${link}"
         style="display:inline-block;padding:14px 28px;background:#1d4ed8;color:#fff;
                text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">
        Confirm my email
      </a>
      <p style="font-size:13px;line-height:1.6;color:#777;margin:24px 0 0">
        This link expires in 24 hours. If you did not create an account, you can ignore this email.
      </p>
      <p style="font-size:12px;color:#999;margin:24px 0 0">CBE QuickSite</p>
    </div>
  `;
}

// Sent when a plan or free trial is about to end
function reminderEmail({ name, kind, daysLeft, orders, total, symbol, link }) {
  const what = kind === "plan" ? "plan" : "free trial";
  const word = daysLeft === 1 ? "day" : "days";

  const stats =
    orders > 0
      ? `Your website got <b>${orders} ${orders === 1 ? "order" : "orders"}</b> worth
         <b>${escapeHtml(symbol)}${Number(total).toLocaleString("en-US")}</b> in the last 30 days.
         Keep it going.`
      : `Keep your website active so customers can keep ordering.`;

  const extra =
    kind === "plan"
      ? "Paying early never loses you days."
      : "After your trial ends, you will not be able to edit your website until you pay.";

  const button = kind === "plan" ? "Renew now" : "Pay to continue";

  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(name)}, your ${what} ends in ${daysLeft} ${word}</h1>
      <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 12px">${stats}</p>
      <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 24px">${extra}</p>
      <a href="${link}"
         style="display:inline-block;padding:14px 28px;background:#1d4ed8;color:#fff;
                text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">
        ${button}
      </a>
      <p style="font-size:12px;color:#999;margin:24px 0 0">CBE QuickSite</p>
    </div>
  `;
}

function naira(symbol, amount) {
  return `${escapeHtml(symbol)}${Number(amount || 0).toLocaleString("en-US")}`;
}

// Sent to the shop owner the moment a customer places an order.
// Everything a customer typed is escaped before it goes into the email.
function newOrderEmail({ shop, number, customer, phone, items, total, symbol, delivery, payment, note, link }) {
  const rows = items
    .map((i) => {
      const extra = [i.variant, i.size, i.color].filter(Boolean).join(", ");
      return `
        <tr>
          <td style="padding:6px 0;font-size:14px;color:#111">
            ${Number(i.qty)} × ${escapeHtml(i.name)}${extra ? ` <span style="color:#777">(${escapeHtml(extra)})</span>` : ""}
          </td>
          <td style="padding:6px 0;font-size:14px;color:#111;text-align:right;white-space:nowrap">
            ${naira(symbol, i.price * i.qty)}
          </td>
        </tr>`;
    })
    .join("");

  const digits = String(phone || "").replace(/\D/g, "");

  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <h1 style="font-size:20px;margin:0 0 6px">New order #${Number(number)}</h1>
      <p style="font-size:14px;color:#666;margin:0 0 18px">${escapeHtml(shop)}</p>

      <p style="font-size:15px;line-height:1.6;margin:0 0 4px"><b>${escapeHtml(customer)}</b></p>
      <p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 16px">
        <a href="https://wa.me/${digits}" style="color:#1d4ed8">+${digits}</a>
      </p>

      <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee;border-bottom:1px solid #eee;margin:0 0 14px">
        ${rows}
        <tr>
          <td style="padding:10px 0 6px;font-size:15px;font-weight:700">Total</td>
          <td style="padding:10px 0 6px;font-size:15px;font-weight:700;text-align:right">${naira(symbol, total)}</td>
        </tr>
      </table>

      <p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 4px">${escapeHtml(delivery)}</p>
      <p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 16px">${escapeHtml(payment)}</p>
      ${note ? `<p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 16px">Note: ${escapeHtml(note)}</p>` : ""}

      <a href="${link}"
         style="display:inline-block;padding:14px 28px;background:#1d4ed8;color:#fff;
                text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">
        View order
      </a>
      <p style="font-size:12px;color:#999;margin:24px 0 0">CBE QuickSite</p>
    </div>
  `;
}

module.exports = { send, resetEmail, verifyEmail, reminderEmail, newOrderEmail };