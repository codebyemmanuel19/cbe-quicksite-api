// Prices live here only. The browser sends a plan id, never an amount.

// What one month costs, by business type
const MONTHLY = {
  default: 7999,
  realestate: 9999,
  cars: 9999,
};

// Every business type gets the same plan shape. Only the amount changes.
// The multipliers are the discount: 3 months costs 2.7 months, not 3.
const SHAPE = [
  { id: "1m", months: 1, days: 30, label: "1 month", multiplier: 1 },
  { id: "3m", months: 3, days: 90, label: "3 months", multiplier: 2.7 },
  { id: "6m", months: 6, days: 180, label: "6 months", multiplier: 5 },
  { id: "12m", months: 12, days: 365, label: "1 year", multiplier: 9 },
];

// Prices that end in 99 are rounded to the nearest 100 minus 1, so 3 months is 21,599, not 21,597.
function tidy(amount, monthly) {
  if (monthly % 100 !== 99) return Math.round(amount);
  return Math.round(amount / 100) * 100 - 1;
}

// `lockedMonthly` is the price a shop was promised when it joined (sites.price_monthly).
// Early vendors keep it for as long as they stay subscribed.
function plansFor(businessType, lockedMonthly) {
  const custom = Number(lockedMonthly);
  const monthly = custom > 0 ? custom : MONTHLY[businessType] || MONTHLY.default;

  const out = {};
  for (const p of SHAPE) {
    out[p.id] = {
      id: p.id,
      months: p.months,
      days: p.days,
      label: p.label,
      amount: tidy(monthly * p.multiplier, monthly),
    };
  }
  return out;
}

// The shop prices, for anything that still asks for PLANS directly
const PLANS = plansFor("default");

module.exports = { PLANS, plansFor, MONTHLY };