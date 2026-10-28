// Prices live here only. The browser sends a plan id, never an amount.
// There is no 1 month plan. Change a price by editing the number below.

// What each kind of business pays for the whole period, in naira.
const PRICES = {
  default: { "3m": 19999, "6m": 34999, "12m": 59999 }, // shops
  realestate: { "3m": 24999, "6m": 44999, "12m": 74999 },
  cars: { "3m": 24999, "6m": 44999, "12m": 74999 },
};

// The plans every business gets, in order.
const SHAPE = [
  { id: "3m", months: 3, days: 90, label: "3 months" },
  { id: "6m", months: 6, days: 180, label: "6 months" },
  { id: "12m", months: 12, days: 365, label: "1 year" },
];

// Only used to work out a shop's promised price (sites.price_monthly), see below.
const MONTHLY = {
  default: 7999,
  realestate: 9999,
  cars: 9999,
};

// Prices that end in 99 stay ending in 99 after scaling.
function tidy(amount, monthly) {
  if (monthly % 100 !== 99) return Math.round(amount);
  return Math.round(amount / 100) * 100 - 1;
}

// `lockedMonthly` is a price a shop was promised when it joined (sites.price_monthly).
// Early vendors keep it. Their prices are the normal prices scaled by how much cheaper they were promised.
// A shop with no promised price pays exactly the numbers in PRICES.
function plansFor(businessType, lockedMonthly) {
  const group = PRICES[businessType] || PRICES.default;
  const baseMonthly = MONTHLY[businessType] || MONTHLY.default;
  const custom = Number(lockedMonthly);
  const scale = custom > 0 ? custom / baseMonthly : 1;

  const out = {};
  for (const p of SHAPE) {
    out[p.id] = {
      id: p.id,
      months: p.months,
      days: p.days,
      label: p.label,
      amount: custom > 0 ? tidy(group[p.id] * scale, custom) : group[p.id],
    };
  }
  return out;
}

// The shop prices, for anything that still asks for PLANS directly
const PLANS = plansFor("default");

module.exports = { PLANS, plansFor, MONTHLY };