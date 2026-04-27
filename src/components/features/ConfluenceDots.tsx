import type { ConfluencePayload, ConfluenceCell } from "@/lib/dashboard-types";

interface ConfluenceDotsProps {
  confluence: ConfluencePayload;
  size?: "sm" | "md";
}

const TFS: { key: keyof ConfluencePayload; label: string }[] = [
  { key: "daily", label: "D" },
  { key: "weekly", label: "W" },
  { key: "monthly", label: "M" },
  { key: "yearly", label: "Y" },
];

const SIZES_MD = { daily: 16, weekly: 18, monthly: 20, yearly: 22 };
const SIZES_SM = { daily: 12, weekly: 14, monthly: 16, yearly: 18 };

export function ConfluenceDots({ confluence, size = "md" }: ConfluenceDotsProps) {
  const sizes = size === "md" ? SIZES_MD : SIZES_SM;
  const summaryParts: string[] = [];
  for (const tf of TFS) {
    const c = confluence[tf.key];
    if (!c) summaryParts.push(`${tf.label} no signal`);
    else
      summaryParts.push(
        `${tf.label} ${c.direction === "buy" ? "Buy" : "Sell"} ${c.count} of ${c.max}`,
      );
  }
  return (
    <div className="flex items-center gap-2" aria-label={summaryParts.join("; ")}>
      <span className="sr-only">{summaryParts.join("; ")}</span>
      {TFS.map((tf) => {
        const c = confluence[tf.key];
        const d = sizes[tf.key as keyof typeof sizes];
        return <Dot key={tf.key} cell={c} label={tf.label} size={d} />;
      })}
    </div>
  );
}

function Dot({ cell, label, size }: { cell: ConfluenceCell | null; label: string; size: number }) {
  if (!cell) {
    return (
      <svg width={size} height={size} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={size / 2 - 1}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={1}
        />
        <text
          x={size / 2}
          y={size / 2 + 3}
          textAnchor="middle"
          fontSize={Math.max(8, size / 2.2)}
          style={{ fill: "var(--text-dim)" }}
          fontFamily="ui-monospace, monospace"
        >
          {label}
        </text>
        <title>{`${label}: no signal`}</title>
      </svg>
    );
  }
  const color = cell.direction === "buy" ? "var(--buy)" : "var(--sell)";
  return (
    <svg width={size} height={size} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill={color} />
      <text
        x={size / 2}
        y={size / 2 + 3}
        textAnchor="middle"
        fontSize={Math.max(8, size / 2.2)}
        fontFamily="ui-monospace, monospace"
        style={{ fill: "var(--bg)" }}
      >
        {cell.count}
      </text>
      <title>{`${label}: ${cell.direction} ${cell.indicator} ${cell.count}/${cell.max}${cell.isPerfected ? " perfected" : ""}`}</title>
    </svg>
  );
}
