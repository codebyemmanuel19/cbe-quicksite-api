// All the "journey" emails: which one a person should get, and what it says.
const crypto = require("crypto");

const DAY = 24 * 60 * 60 * 1000;
const MIN_GAP_DAYS = 0.8; // never two emails to one person within ~20 hours
const TIP_GAP_DAYS = 6; // weekly tips
const TIP_KEYS = ["tip1", "tip2", "tip3", "tip4", "tip5"];

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Proves an unsubscribe link was made by us, so nobody can unsubscribe other people
function unsubToken(userId) {
  const secret = String(process.env.JWT_SECRET || "");
  return crypto.createHmac("sha256", secret).update(`unsub:${userId}`).digest("hex").slice(0, 32);
}

// Decides the ONE email this person should get now (or null).
// Registered > no products > few products > installed > trial ended > weekly tips
function pick(u, now) {
  const sent = new Set(u.sent || []);
  const age = (now - new Date(u.created_at).getTime()) / DAY;
  const sinceLast = u.last_sent ? (now - new Date(u.last_sent).getTime()) / DAY : Infinity;

  // Welcome goes first and ignores the gap
  if (!sent.has("welcome") && age <= 3) return "welcome";

  // Paid at any time: the billing reminders look after them, not this job
  if (u.paid_until) return null;

  const items = Number(u.items) || 0;
  const hasSite = !!u.site_id;
  const started = !!u.trial_ends_at;
  const endedFor = started ? (now - new Date(u.trial_ends_at).getTime()) / DAY : -1;
  const ended = started && endedFor >= 0;

  const list = [];
  if (!ended) {
    list.push(["no_products", hasSite && items === 0 && age >= 1]);
    list.push(["few_products", items >= 1 && items <= 2 && age >= 1]);
    list.push(["install", !u.installed_at && age >= 2]);
    list.push(["checkin3", items < 3 && age >= 3]);
    list.push(["dormant14", !started && age >= 14]);
  } else {
    list.push(["trial_ended", endedFor >= 0]);
    list.push(["after1", endedFor >= 1]);
    list.push(["after3", endedFor >= 3]);
    list.push(["after7", endedFor >= 7]);
  }

  for (const [key, ok] of list) {
    if (ok && !sent.has(key) && sinceLast >= MIN_GAP_DAYS) return key;
  }

  // Weekly tips, only after the main emails are done
  const tipsOpen = ended ? endedFor >= 14 : !started && age >= 21;
  if (tipsOpen && sinceLast >= TIP_GAP_DAYS) {
    const next = TIP_KEYS.find((k) => !sent.has(k));
    if (next) return next;
  }

  return null;
}

function content(key, c) {
  const hi = `Hi ${c.name},`;
  const startPath = c.hasSite ? "/dashboard" : "/setup";

  switch (key) {
    case "welcome":
      return {
        subject: "Welcome to CBEQuickSite 🎉",
        paras: [
          hi,
          "Welcome to CBEQuickSite. Your 7-day free trial has started.",
          `Your website is ready to set up. Start by adding your business information and ${c.noun} so customers can find and explore your business online.`,
        ],
        button: "Set Up My Website",
        path: startPath,
      };
    case "no_products":
      return {
        subject: `Your website needs your ${c.noun}`,
        paras: [
          hi,
          "Your website is already created. Now let's make it useful for your customers.",
          `Add your first ${c.noun} with their photos, names and prices.`,
        ],
        button: `Add My ${c.Noun}`,
        path: c.addPath,
      };
    case "few_products":
      return {
        subject: "You're getting there 👏",
        paras: [
          hi,
          "You've already started setting up your website.",
          `Add a few more ${c.noun} so your customers have more to explore.`,
        ],
        button: `Continue Adding ${c.Noun}`,
        path: c.addPath,
      };
    case "install":
      return {
        subject: "Keep your business one tap away 📱",
        paras: [
          hi,
          "Your CBEQuickSite website can stay easily accessible on your phone.",
          "Add it to your home screen so you can quickly manage your business whenever you need to.",
        ],
        button: "Open My Website",
        path: startPath,
      };
    case "checkin3":
      return {
        subject: "How is your website coming along?",
        paras: [
          hi,
          "Just checking in. Your CBEQuickSite website is waiting for you.",
          `Add your ${c.noun}, update your business information and make your website ready for customers.`,
        ],
        button: "Continue Setup",
        path: startPath,
      };
    case "trial_ended":
      return {
        subject: "Your CBEQuickSite trial has ended",
        paras: [
          hi,
          "Your 7-day free trial has ended.",
          "You can continue using your CBEQuickSite website by choosing a plan.",
        ],
        button: "Continue With CBEQuickSite",
        path: "/dashboard/billing",
      };
    case "after1":
      return {
        subject: "Don't leave your website unfinished",
        paras: [
          hi,
          "You started building your online presence with CBEQuickSite.",
          "If you haven't finished setting up your website yet, you can come back and continue.",
        ],
        button: "Continue My Website",
        path: "/dashboard/billing",
      };
    case "after3":
      return {
        subject: "Your customers can find you online",
        paras: [
          hi,
          `Having your ${c.noun} online makes it easier for customers to see what you offer and contact your business.`,
          "Come back and finish setting up your website.",
        ],
        button: "Open My Website",
        path: "/dashboard/billing",
      };
    case "after7":
    case "dormant14":
      return {
        subject: "Ready to continue?",
        paras: [
          hi,
          "It's been a little while since you created your CBEQuickSite account.",
          "Your website is still there. You can come back anytime and continue building your online presence.",
        ],
        button: "Return to CBEQuickSite",
        path: key === "dormant14" ? startPath : "/dashboard/billing",
      };
    case "tip1":
      return {
        subject: "3 things every business website should have",
        paras: [
          hi,
          "A website that turns visitors into customers has three things:",
          "1. Clear photos and prices, so people do not have to ask.<br>2. An easy way to reach you, like a WhatsApp button.<br>3. Your business name and location, so people trust you.",
        ],
      };
    case "tip2":
      return {
        subject: "Why customers visit but don't buy",
        paras: [
          hi,
          "Most people leave for one of four reasons: no price, no photos, slow replies, or they are not sure the business is real.",
          "Show your prices, use clear photos, and make your contact details easy to find. That alone brings back customers you were losing.",
        ],
      };
    case "tip3":
      return {
        subject: "How to make your products easier to find",
        paras: [
          hi,
          "Put your website link in your Instagram bio and your WhatsApp status.",
          "Use simple names for your items, like \"Black leather handbag\" instead of \"New arrival\". Customers search with simple words.",
        ],
      };
    case "tip4":
      return {
        subject: "Why your business needs more than Instagram",
        paras: [
          hi,
          "Instagram posts disappear down the feed and DMs get lost. A website stays open 24 hours a day with all your items in one place.",
          "Customers can look, choose and reach you without waiting for a reply.",
        ],
        button: "Open My Website",
        path: "/dashboard",
      };
    case "tip5":
      return {
        subject: "5 things customers look for before buying",
        paras: [
          hi,
          "Before they buy, people look for: clear photos, a clear price, proof that you are real, delivery details, and an easy way to contact you.",
          "Check your website against this list today.",
        ],
        button: "Open My Website",
        path: "/dashboard",
      };
    default:
      return null;
  }
}

function render({ subject, paras, button, link, unsubUrl }) {
  const body = paras
    .map((p) => `<p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 14px">${p}</p>`)
    .join("");

  const cta = button
    ? `<a href="${link}" style="display:inline-block;margin-top:10px;padding:14px 28px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">${escapeHtml(button)}</a>`
    : "";

  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(subject)}</h1>
      ${body}
      ${cta}
      <p style="font-size:12px;color:#999;margin:28px 0 0">CBE QuickSite</p>
      <p style="font-size:12px;color:#999;margin:6px 0 0">
        Do not want these emails? <a href="${unsubUrl}" style="color:#999">Unsubscribe</a>
      </p>
    </div>
  `;
}

// ctx: { name, businessType, hasSite, app, unsubUrl }
function buildEmail(key, ctx) {
  const realestate = ctx.businessType === "realestate";
  const noun = realestate ? "properties" : "products";
  const c = {
    name: escapeHtml(ctx.name || "there"),
    noun,
    Noun: noun[0].toUpperCase() + noun.slice(1),
    hasSite: ctx.hasSite,
    addPath: realestate ? "/dashboard/properties" : "/dashboard/products",
  };

  const data = content(key, c);
  if (!data) return null;

  return {
    subject: data.subject,
    html: render({
      subject: data.subject,
      paras: data.paras,
      button: data.button,
      link: data.path ? `${ctx.app}${data.path}` : "",
      unsubUrl: ctx.unsubUrl,
    }),
  };
}

module.exports = { pick, buildEmail, unsubToken };