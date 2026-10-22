// The Monday "your week" email: visits, orders (or inquiries), low stock.
const { layout } = require("./mail");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const BRAND = "#1d4ed8";
const num = (n) => Number(n || 0).toLocaleString("en-US");

function cell(value, label) {
  return `<td style="text-align:center;padding:14px 6px;background:#f3f6ff;border-radius:12px">
    <div style="font-size:28px;font-weight:800;color:${BRAND};line-height:1.1">${value}</div>
    <div style="font-size:12px;color:#6b7280;margin-top:4px">${label}</div></td>`;
}

// Shops and restaurants take orders. Real estate, cars and furniture get inquiries.
function leadWord(businessType, count) {
  const orders = !["realestate", "cars", "furniture"].includes(businessType);
  const one = orders ? "order" : "inquiry";
  return count === 1 ? one : orders ? "orders" : "inquiries";
}

function weeklyEmail(s) {
  const visits = Number(s.visits) || 0;
  const prev = Number(s.prevVisits) || 0;
  const leads = Number(s.leads) || 0;
  const word = leadWord(s.businessType, leads);
  const tracksStock = !["realestate", "cars", "restaurant", "furniture"].includes(s.businessType);

  const cells = [cell(num(visits), visits === 1 ? "visit" : "visits"), cell(num(leads), word)];
  if (tracksStock && s.lowStock > 0) cells.push(cell(num(s.lowStock), "low on stock"));
  const row = `<table role="presentation" width="100%" cellspacing="8" cellpadding="0" style="margin:0 -4px 18px"><tr>${cells.join("")}</tr></table>`;

  const paras = [];

  if (visits === 0) {
    paras.push(
      "Nobody opened your website this week. Share your link on your WhatsApp status and in your Instagram bio. It takes one minute and it is how customers find you."
    );
  } else {
    if (prev > 0) {
      const change = Math.round(((visits - prev) / prev) * 100);
      if (change >= 10) paras.push(`That is <b>${change}% more</b> than last week. Keep sharing your link.`);
      else if (change <= -10) paras.push(`That is ${Math.abs(change)}% fewer than last week. Post your link again this week.`);
    }
    if (leads === 0) {
      paras.push(
        "People are looking but nobody ordered yet. Clear photos and a short description on each item help a lot."
      );
    } else if (s.revenue > 0) {
      paras.push(`Orders this week came to <b>${escapeHtml(s.symbol)}${num(s.revenue)}</b>.`);
    }
  }

  if (tracksStock && s.lowStock > 0) {
    paras.push(
      `<b>${s.lowStock}</b> ${s.lowStock === 1 ? "product is" : "products are"} almost finished. Update your stock so customers do not order what is not there.`
    );
  }

  return layout({
    title: visits > 0 ? `Your week: ${num(visits)} ${visits === 1 ? "visit" : "visits"} and ${num(leads)} ${word}` : "Your week on CBE QuickSite",
    badge: "Weekly results",
    greeting: s.name,
    paras: [], // the numbers come first, then the notes
    extra: row + paras.map((p) => `<p style="font-size:16px;line-height:1.7;color:#374151;margin:0 0 16px">${p}</p>`).join(""),
    button: visits === 0 ? "Share my website" : "Open my dashboard",
    link: s.link,
    note: `Visits are the people who opened ${escapeHtml(s.shopUrl)} in the last 7 days.`,
    unsubUrl: s.unsubUrl,
  });
}

module.exports = { weeklyEmail };