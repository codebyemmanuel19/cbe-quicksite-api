// All the "journey" emails: which one a person should get, and what it says.
const crypto = require("crypto");
const { layout } = require("./mail");
const { billingStatus, OFFLINE_AFTER_DAYS } = require("./middleware/locked");

const DAY = 24 * 60 * 60 * 1000;
const MIN_GAP_DAYS = 0.8; // never two emails to one person within ~20 hours
const TIP_GAP_DAYS = 6; // weekly tips
const WARN_AFTER_DAYS = 2; // the offline warning goes out 2 days after the lock (5 days before it goes offline)
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

const ts = (d) => (d ? new Date(d).getTime() : 0);

// Where this person stands, and the day their plan or trial finished
function describe(u) {
  if (!u.site_id) return { status: "none", since: 0 };
  const status = billingStatus({ paid_until: u.paid_until, trial_ends_at: u.trial_ends_at }, Number(u.items) || 0);
  return { status, since: Math.max(ts(u.paid_until), ts(u.trial_ends_at)) };
}

// Monday morning in Lagos (UTC+1). Returns that Monday's date, or "" on other days.
function lagosMonday(now) {
  const t = new Date(now + 60 * 60 * 1000);
  return t.getUTCDay() === 1 && t.getUTCHours() >= 9 ? t.toISOString().slice(0, 10) : "";
}

// Decides the ONE email this person should get now (or null).
//  Account emails (lock, offline) always go out. Marketing emails stop if they unsubscribed.
//  Paid or trial reminders ("plan ending soon") are sent by the reminders job, not here.
function pick(u, now) {
  const sent = new Set(u.sent || []);
  const age = (now - ts(u.created_at)) / DAY;
  const sinceLast = u.last_sent ? (now - ts(u.last_sent)) / DAY : Infinity;
  const unsub = !!u.unsubscribed_at;
  const items = Number(u.items) || 0;
  const hasSite = !!u.site_id;
  const { status, since } = describe(u);

  // 1. Welcome goes first and ignores the gap
  if (!unsub && !sent.has("welcome") && age <= 3) return "welcome";

  // Paid and running: the billing reminders look after them
  if (status === "active") return null;

  // 2. A paid plan or a trial finished
  if (status === "locked" || status === "offline") {
    if (sinceLast < MIN_GAP_DAYS) return null;
    const day = new Date(since || now).toISOString().slice(0, 10);

    if (status === "offline") {
      if (!sent.has(`offline:${day}`)) return `offline:${day}`;
    } else {
      if (!sent.has(`locked:${day}`)) return `locked:${day}`;
      if (now >= since + WARN_AFTER_DAYS * DAY && !sent.has(`offline_warn:${day}`)) return `offline_warn:${day}`;
    }

    // 3. Monday reminder to people who have not paid: 4 weeks in a row, then the first Monday of each month
    if (unsub) return null;
    const monday = lagosMonday(now);
    if (!monday || sinceLast < 5 || sent.has(`nudge:${monday}`)) return null;
    const nudges = [...sent].filter((k) => k.startsWith("nudge:")).length;
    if (nudges < 4 || Number(monday.slice(8, 10)) <= 7) return `nudge:${monday}`;
    return null;
  }

  // Everyone below is free or on a trial, and may still be setting up
  if (unsub) return null;

  const list = [];
  list.push(["limit_reached", status === "free" && items >= 3]);
  list.push(["no_site", !hasSite && age >= 1]);
  list.push(["no_products", hasSite && items === 0 && age >= 1]);
  list.push(["few_products", items >= 1 && items <= 2 && age >= 1]);
  list.push(["install", !u.installed_at && age >= 2]);
  list.push(["checkin3", hasSite && items < 3 && age >= 3]);
  list.push(["dormant14", hasSite && items === 0 && age >= 14]);

  for (const [key, ok] of list) {
    if (ok && !sent.has(key) && sinceLast >= MIN_GAP_DAYS) return key;
  }

  // Weekly tips, only after the main emails are done
  if (age >= 21 && sinceLast >= TIP_GAP_DAYS) {
    const next = TIP_KEYS.find((k) => !sent.has(k));
    if (next) return next;
  }

  return null;
}

function content(key, c) {
  const hi = `Hi ${c.name},`;
  const startPath = c.hasSite ? "/dashboard" : "/setup";
  const daysToOffline = Math.max(1, Math.ceil((c.since + OFFLINE_AFTER_DAYS * DAY - Date.now()) / DAY));
  const dayWord = (n) => (n === 1 ? "day" : "days");

  switch (key.split(":")[0]) {
    case "welcome":
      return {
        subject: "Welcome to CBE QuickSite 🎉",
        badge: "Welcome",
        paras: [
          hi,
          `Your account is ready. You can add your first 3 ${c.noun} for free. No payment needed to start.`,
          `Start by adding your business information and your ${c.noun}, so customers can find your business online.`,
        ],
        button: "Set up my website",
        path: startPath,
      };

    case "no_site":
      return {
        subject: "Finish setting up your website",
        badge: "Almost there",
        paras: [
          hi,
          "You created your CBE QuickSite account, but your website is not set up yet.",
          "It takes about 2 minutes. Choose your business type, add your business name, and your website is live.",
        ],
        button: "Set up my website",
        path: "/setup",
      };

    case "no_products":
      return {
        subject: `Your website needs your ${c.noun}`,
        badge: "Next step",
        paras: [
          hi,
          "Your website is already created. Now let's make it useful for your customers.",
          `Add your first ${c.noun} with photos, names and prices.`,
        ],
        button: `Add my ${c.noun}`,
        path: c.addPath,
      };

    case "few_products":
      return {
        subject: "You're getting there 👏",
        badge: "Keep going",
        paras: [
          hi,
          "You have already started setting up your website.",
          `Add a few more ${c.noun} so your customers have more to look at.`,
        ],
        button: `Add more ${c.noun}`,
        path: c.addPath,
      };

    case "install":
      return {
        subject: "Keep your business one tap away 📱",
        badge: "Quick tip",
        paras: [
          hi,
          "Your CBE QuickSite dashboard can stay on your phone like an app.",
          "Add it to your home screen so you can manage your business whenever you need to.",
        ],
        button: "Open my website",
        path: startPath,
      };

    case "checkin3":
      return {
        subject: "How is your website coming along?",
        badge: "Quick check-in",
        paras: [
          hi,
          "Just checking in. Your CBE QuickSite website is waiting for you.",
          `Add your ${c.noun}, update your business information and make your website ready for customers.`,
        ],
        button: "Continue setup",
        path: startPath,
      };

    case "limit_reached":
      return {
        subject: `Pay to keep adding ${c.noun}`,
        badge: "Free limit reached",
        paras: [
          hi,
          `You have added your 3 free ${c.noun}, and your website is live for your customers.`,
          `To keep adding ${c.noun} and keep your website active for your customers, choose a plan. It takes a minute.`,
        ],
        button: "Choose a plan",
        path: "/dashboard/billing",
      };

    case "locked":
      return {
        subject: "Your subscription has finished",
        badge: "Subscription finished",
        paras: [
          hi,
          "Your CBE QuickSite subscription has finished, so you can't make changes to your website right now.",
          `Your website is still live for your customers for ${daysToOffline} more ${dayWord(daysToOffline)}. Upgrade now so you can keep adding and editing.`,
        ],
        button: "Upgrade my website",
        path: "/dashboard/billing",
      };

    case "offline_warn":
      return {
        subject: `Your website goes offline in ${daysToOffline} ${dayWord(daysToOffline)}`,
        badge: "Action needed",
        paras: [
          hi,
          `Your website is still live, but it goes offline in ${daysToOffline} ${dayWord(daysToOffline)} if you do not renew.`,
          "When it goes offline, your customers will not be able to see your products or contact you from your website.",
          "Pay now to keep it active.",
        ],
        button: "Keep my website active",
        path: "/dashboard/billing",
      };

    case "offline":
      return {
        subject: "Your website is offline",
        badge: "Website offline",
        paras: [
          hi,
          "Your website is offline, so your customers can't see it right now.",
          "Choose a plan and it comes back online straight away. Your products and settings are all saved.",
        ],
        button: "Bring my website back online",
        path: "/dashboard/billing",
      };

    case "nudge":
      return {
        subject: c.status === "offline" ? "Your customers can't find your website" : "A quick reminder about your website",
        badge: "Reminder",
        paras: [
          hi,
          c.status === "offline"
            ? "Your website is offline. People who open your link see a message that it is not available right now."
            : "Your subscription has finished, so you can't add or edit anything on your website.",
          "Choose a plan to get back to selling. Your products and settings are saved and waiting for you.",
        ],
        button: "Choose a plan",
        path: "/dashboard/billing",
      };

    case "dormant14":
      return {
        subject: "Ready to continue?",
        badge: "We miss you",
        paras: [
          hi,
          "It has been a little while since you created your CBE QuickSite account.",
          "Your website is still there. Come back anytime and continue building your online presence.",
        ],
        button: "Return to CBE QuickSite",
        path: startPath,
      };

    case "tip1":
      return {
        subject: "3 things every business website should have",
        badge: "Tip",
        paras: [
          hi,
          "A website that turns visitors into customers has three things:",
          "1. Clear photos and prices, so people do not have to ask.<br>2. An easy way to reach you, like a WhatsApp button.<br>3. Your business name and location, so people trust you.",
        ],
      };
    case "tip2":
      return {
        subject: "Why customers visit but don't buy",
        badge: "Tip",
        paras: [
          hi,
          "Most people leave for one of four reasons: no price, no photos, slow replies, or they are not sure the business is real.",
          "Show your prices, use clear photos, and make your contact details easy to find. That alone brings back customers you were losing.",
        ],
      };
    case "tip3":
      return {
        subject: "How to make your products easier to find",
        badge: "Tip",
        paras: [
          hi,
          "Put your website link in your Instagram bio and your WhatsApp status.",
          "Use simple names for your items, like \"Black leather handbag\" instead of \"New arrival\". Customers search with simple words.",
        ],
      };
    case "tip4":
      return {
        subject: "Why your business needs more than Instagram",
        badge: "Tip",
        paras: [
          hi,
          "Instagram posts disappear down the feed and DMs get lost. A website stays open 24 hours a day with all your items in one place.",
          "Customers can look, choose and reach you without waiting for a reply.",
        ],
        button: "Open my website",
        path: "/dashboard",
      };
    case "tip5":
      return {
        subject: "5 things customers look for before buying",
        badge: "Tip",
        paras: [
          hi,
          "Before they buy, people look for: clear photos, a clear price, proof that you are real, delivery details, and an easy way to contact you.",
          "Check your website against this list today.",
        ],
        button: "Open my website",
        path: "/dashboard",
      };
    default:
      return null;
  }
}

// Emails about someone's account (lock, offline) never carry an unsubscribe link
const ACCOUNT_KEYS = ["locked", "offline_warn", "offline"];

// ctx: { name, businessType, hasSite, app, unsubUrl, status, since }
function buildEmail(key, ctx) {
  const type = ctx.businessType;
  const noun =
    type === "realestate" ? "properties" : type === "cars" ? "cars" : type === "restaurant" ? "dishes" : type === "furniture" ? "pieces" : "products";
  const addPath =
    type === "realestate"
      ? "/dashboard/properties"
      : type === "cars"
        ? "/dashboard/cars"
        : type === "restaurant"
          ? "/dashboard/menu"
          : type === "furniture"
            ? "/dashboard/furniture"
            : "/dashboard/products";

  const c = {
    name: escapeHtml(ctx.name || "there"),
    noun,
    hasSite: ctx.hasSite,
    addPath,
    status: ctx.status,
    since: ctx.since || Date.now(),
  };

  const data = content(key, c);
  if (!data) return null;

  const base = key.split(":")[0];
  return {
    subject: data.subject,
    html: layout({
      title: data.subject,
      badge: data.badge,
      paras: data.paras,
      button: data.button,
      link: data.path ? `${ctx.app}${data.path}` : "",
      unsubUrl: ACCOUNT_KEYS.includes(base) ? "" : ctx.unsubUrl,
    }),
  };
}

module.exports = { pick, buildEmail, unsubToken, describe };