/**
 * Adaptive price/percent formatting.
 *
 * Penny stocks: 4dp.   Normal: 2dp.   Mega caps in tile headers: "$621.0k".
 */

export function formatPrice(value: number, options: { compact?: boolean } = {}): string {
  if (!Number.isFinite(value)) return "—";
  if (options.compact && value >= 1000) {
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}b`;
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`;
    return `$${(value / 1000).toFixed(1)}k`;
  }
  if (Math.abs(value) < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)}%`;
}
