// Server-side source of truth. The browser never decides currency or dialling code.
const COUNTRIES = {
  NG: { name: "Nigeria", currency: "NGN", symbol: "₦", dialCode: "234", live: true },
  GH: { name: "Ghana", currency: "GHS", symbol: "₵", dialCode: "233", live: false },
  KE: { name: "Kenya", currency: "KES", symbol: "KSh", dialCode: "254", live: false },
  UG: { name: "Uganda", currency: "UGX", symbol: "USh", dialCode: "256", live: false },
};

module.exports = { COUNTRIES };