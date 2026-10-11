export const BRAND_SLOTS = 4;
export const MAX_BRAND_DAYS = 365;
export function brandAmount(days) {
  if (!Number.isInteger(days) || days < 1 || days > MAX_BRAND_DAYS) return null;
  return Math.round(100000 * days / 7);
}
export function formatBrandAmount(amount) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount / 100);
}
