"use client";
import { useState } from "react";
import type { RankingFactor } from "@/lib/dashboard-types";

interface Props {
  factors: RankingFactor[];
}

export function RankingFactorsExpander({ factors }: Props) {
  const [open, setOpen] = useState(false);
  if (factors.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="text-[11px] text-text-muted hover:text-text underline-offset-2 hover:underline"
      >
        Why this one? {open ? "▾" : "▸"}
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {factors.map((f, i) => (
            <li key={i} className="flex justify-between text-[11px] font-mono text-text-muted">
              <span>{f.label}</span>
              <span className={f.contribution >= 0 ? "text-buy" : "text-sell"}>
                {f.contribution > 0 ? "+" : ""}
                {f.contribution.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
