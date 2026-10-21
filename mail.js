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

const BRAND = "#1d4ed8";
const FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

// One look for every email: coloured header, small badge, greeting, text, button, sign-off, footer.
// Pass `paras` as ready HTML (escape anything a user typed before it gets here).
function layout({ title, badge, greeting, paras = [], extra = "", button, link, note, unsubUrl }) {
  const body = paras
    .map((p) => `<p style="font-size:16px;line-height:1.7;color:#374151;margin:0 0 16px">${p}</p>`)
    .join("");

  const cta =
    button && link
      ? `<a href="${link}" style="display:inline-block;margin:8px 0 6px;padding:15px 30px;background:${BRAND};color:#ffffff;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700">${escapeHtml(button)}</a>`
      : "";

  return `
  <div style="background:#f3f5fa;padding:24px 12px;font-family:${FONT}">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="background:${BRAND};padding:30px 28px">
        <p style="margin:0 0 10px;font-size:13px;letter-spacing:2px;font-weight:700;color:#bfd0ff;text-transform:uppercase">CBE QuickSite</p>
        <h1 style="margin:0;font-size:25px;line-height:1.3;color:#ffffff;font-weight:800">${escapeHtml(title)}</h1>
      </div>
      <div style="padding:28px">
        ${badge ? `<span style="display:inline-block;margin:0 0 20px;padding:7px 14px;background:#e8efff;color:${BRAND};border-radius:999px;font-size:13px;font-weight:700">${escapeHtml(badge)}</span>` : ""}
        ${greeting ? `<p style="font-size:16px;line-height:1.7;color:#111827;margin:0 0 16px">Hi ${escapeHtml(greeting)},</p>` : ""}
        ${body}
        ${extra}
        ${cta}
        ${note ? `<p style="font-size:13px;line-height:1.6;color:#6b7280;margin:14px 0 0">${note}</p>` : ""}
        <p style="font-size:16px;line-height:1.6;color:#374151;margin:28px 0 0">Regards,<br><b style="color:#111827">The CBE QuickSite Team</b></p>
        <div style="border-top:1px solid #e5e7eb;margin:26px 0 0;padding-top:16px">
          <p style="font-size:12px;line-height:1.6;color:#9ca3af;margin:0">
            You are receiving this email because you created a website on CBE QuickSite.
            ${unsubUrl ? `<br>Do not want these emails? <a href="${unsubUrl}" style="color:#9ca3af">Unsubscribe</a>` : ""}
          </p>
        </div>
      </div>
    </div>
  </div>`;
}

function resetEmail(link) {
  return layout({
    title: "Reset your password",
    badge: "Password reset",
    paras: ["Tap the button below to choose a new password. This link works once and expires in 1 hour."],
    button: "Reset password",
    link,
    note: "If you did not ask for this, you can ignore this email. Your password stays the same.",
  });
}

// Sent the moment someone signs up
function verifyEmail(link) {
  return layout({
    title: "Confirm your email",
    badge: "One quick step",
    paras: [
      "Welcome to CBE QuickSite. Tap the button below so we know this email is really yours. That way you can always get back into your account.",
    ],
    button: "Confirm my email",
    link,
    note: "This link expires in 24 hours. If you did not create an account, you can ignore this email.",
  });
}

// Sent when a plan or free trial is about to end (5 days and 1 day before)
function reminderEmail({ name, kind, daysLeft, orders, total, symbol, link }) {
  const word = daysLeft === 1 ? "day" : "days";
  const when = daysLeft <= 1 ? "tomorrow" : `in ${daysLeft} ${word}`;
  const what = kind === "plan" ? "plan" : "free trial";

  const stats =
    orders > 0
      ? `Your website got <b>${orders} ${orders === 1 ? "order" : "orders"}</b> worth
         <b>${escapeHtml(symbol)}${Number(total).toLocaleString("en-US")}</b> in the last 30 days. Keep it going.`
      : "Keep your website active so customers can keep finding you.";

  const extra =
    kind === "plan"
      ? "Renew early and you never lose a day."
      : "After your trial ends, you will not be able to edit your website until you choose a plan.";

  return layout({
    title: `Your ${what} ends ${when}`,
    badge: kind === "plan" ? "Renewal reminder" : "Trial ending soon",
    greeting: name,
    paras: [stats, extra],
    button: kind === "plan" ? "Renew now" : "Choose a plan",
    link,
    note: "If you have already renewed, no action is needed.",
  });
}

// Sent the moment a payment goes through
function paymentEmail({ name, months, until, link }) {
  const label = months === 1 ? "1 month" : `${months} months`;
  return layout({
    title: "Payment received. Thank you!",
    badge: "Website active",
    greeting: name,
    paras: [
      `We received your payment for <b>${label}</b>. Your website is active until <b>${escapeHtml(until)}</b>.`,
      "You can add and edit products again, and your customers can see everything.",
    ],
    button: "Open my dashboard",
    link,
  });
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

  const details = `
    <p style="font-size:16px;line-height:1.6;margin:0 0 2px;color:#111827"><b>${escapeHtml(customer)}</b></p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px"><a href="https://wa.me/${digits}" style="color:${BRAND}">+${digits}</a></p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;margin:0 0 16px">
      ${rows}
      <tr>
        <td style="padding:10px 0 6px;font-size:16px;font-weight:700">Total</td>
        <td style="padding:10px 0 6px;font-size:16px;font-weight:700;text-align:right">${naira(symbol, total)}</td>
      </tr>
    </table>
    <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 4px">${escapeHtml(delivery)}</p>
    <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 16px">${escapeHtml(payment)}</p>
    ${note ? `<p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 16px">Note: ${escapeHtml(note)}</p>` : ""}`;

  return layout({
    title: `New order #${Number(number)}`,
    badge: shop,
    extra: details,
    button: "View order",
    link,
  });
}

module.exports = { layout, paymentEmail, send, resetEmail, verifyEmail, reminderEmail, newOrderEmail };