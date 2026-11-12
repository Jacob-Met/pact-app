export function parseUtcControl(value, { optional = false } = {}) {
  if (value === "" && optional) return null;
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(value)) throw new Error("Enter a complete UTC date and time.");
  const [wholeInput, fraction = ""] = value.split(".");
  const whole = wholeInput.length === 16 ? `${wholeInput}:00` : wholeInput;
  const candidate = `${whole}.${fraction.padEnd(3, "0")}Z`;
  let canonical;
  try { canonical = new Date(candidate).toISOString(); } catch { throw new Error("Enter a valid UTC date and time."); }
  if (canonical !== candidate) throw new Error("Enter a valid UTC date and time.");
  return canonical;
}

export function formatUtcControl(iso) {
  const canonical = new Date(iso).toISOString();
  if (canonical !== iso) throw new Error("Expected a canonical UTC instant.");
  return iso.slice(0, 23);
}

export function formatUsdMinor(minor) {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("Expected a non-negative safe integer amount.");
  const value = BigInt(minor); const whole = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); const cents = (value % 100n).toString().padStart(2, "0");
  return `$${whole}.${cents}`;
}
