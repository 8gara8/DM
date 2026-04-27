import type { Bar, Tone } from "@/engine/types";

interface SparklineProps {
  bars: Bar[];
  markers: { barDate: string; text: string; tone: Tone }[];
  lookbackLabel: string;
  height?: number;
  width?: number;
  ariaLabel: string;
}

const TONE_COLOR: Record<Tone, string> = {
  buy: "var(--buy)",
  sell: "var(--sell)",
  "buy-perfected": "var(--buy)",
  "sell-perfected": "var(--sell)",
  "buy-13": "var(--buy)",
  "sell-13": "var(--sell)",
  deferred: "var(--warning)",
  recycle: "var(--text-muted)",
};

export function Sparkline({
  bars,
  markers,
  lookbackLabel,
  height = 40,
  width = 200,
  ariaLabel,
}: SparklineProps) {
  if (bars.length === 0) {
    return (
      <div
        role="img"
        aria-label={ariaLabel}
        className="text-text-dim text-xs italic"
        style={{ height }}
      >
        no bars
      </div>
    );
  }
  const closes = bars.map((b) => b.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const lastClose = closes[closes.length - 1]!;
  const firstClose = closes[0]!;
  const trendUp = lastClose >= firstClose;

  const xStep = bars.length > 1 ? width / (bars.length - 1) : width;
  const yFor = (close: number) =>
    height - ((close - min) / span) * (height - 6) - 3;
  const points = closes.map((c, i) => `${i * xStep},${yFor(c)}`).join(" ");

  const dateToIdx = new Map(bars.map((b, i) => [b.date, i]));

  return (
    <svg
      role="img"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
    >
      <title>{ariaLabel}</title>
      <text
        x={4}
        y={10}
        className="fill-text-dim font-mono"
        fontSize={9}
        style={{ fill: "var(--text-dim)" }}
      >
        {lookbackLabel}
      </text>
      <polyline
        fill="none"
        stroke={trendUp ? "var(--buy)" : "var(--sell)"}
        strokeWidth={1.25}
        points={points}
      />
      {markers.map((m, i) => {
        const idx = dateToIdx.get(m.barDate);
        if (idx == null) return null;
        const x = idx * xStep;
        const y = yFor(closes[idx]!);
        const isAbove = m.tone.startsWith("sell");
        const color = TONE_COLOR[m.tone] ?? "var(--text)";
        const isCompletion = m.tone.endsWith("-13") || m.tone.endsWith("-perfected");
        const fontSize = isCompletion ? 13 : 9;
        return (
          <text
            key={i}
            x={x}
            y={isAbove ? y - 4 : y + fontSize + 2}
            textAnchor="middle"
            fontSize={fontSize}
            fontFamily="ui-monospace, monospace"
            style={{ fill: color }}
          >
            {m.text}
          </text>
        );
      })}
    </svg>
  );
}
