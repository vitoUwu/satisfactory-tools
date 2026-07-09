/** Small formatting helpers shared across Planner UI. */

/** Round to at most 2 decimals and strip trailing zeros. */
export function fmtRate(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? r.toString() : r.toFixed(2).replace(/\.?0+$/, "");
}

/** Format a MW power value with sign. */
export function fmtPower(mw: number): string {
  const sign = mw > 0 ? "+" : "";
  return `${sign}${fmtRate(mw)} MW`;
}

/** Efficiency percentage → rounded integer string. */
export function fmtEfficiency(pct: number): string {
  return `${Math.round(pct)}%`;
}
