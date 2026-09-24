// Prices live here only. The browser sends a plan id, never an amount.
const PLANS = {
  "1m": { id: "1m", months: 1, days: 30, amount: 5000, label: "1 month" },
  "3m": { id: "3m", months: 3, days: 90, amount: 13500, label: "3 months" },
  "6m": { id: "6m", months: 6, days: 180, amount: 25000, label: "6 months" },
  "12m": { id: "12m", months: 12, days: 365, amount: 45000, label: "1 year" },
};

module.exports = { PLANS };