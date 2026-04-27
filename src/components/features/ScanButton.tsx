"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

interface ScanButtonProps {
  scope?: "all" | { ticker: string };
  label?: string;
}

type State =
  | { kind: "idle" }
  | { kind: "running"; runId: string; progress: { done: number; total: number } }
  | { kind: "error"; message: string };

export function ScanButton({ scope = "all", label }: ScanButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });

  const trigger = useCallback(async () => {
    setState({ kind: "running", runId: "pending", progress: { done: 0, total: 0 } });
    try {
      const body =
        scope === "all"
          ? {}
          : { tickers: [scope.ticker] };
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j?.data) throw new Error(j?.error?.message ?? "scan failed");
      setState({
        kind: "running",
        runId: j.data.scanRunId,
        progress: { done: j.data.tickersSucceeded ?? 0, total: j.data.tickersAttempted ?? 0 },
      });
      router.refresh();
      // Quickly transition to idle — the API call already awaited completion
      setTimeout(() => setState({ kind: "idle" }), 1000);
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      setTimeout(() => setState({ kind: "idle" }), 4000);
    }
  }, [scope, router]);

  // Optional polling — for future when /api/scan returns 202 immediately
  useEffect(() => {
    if (state.kind !== "running" || state.runId === "pending") return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const r = await fetch(`/api/scans/${state.runId}`);
        const j = await r.json();
        if (j?.data?.finishedAt) {
          setState({ kind: "idle" });
          router.refresh();
          return;
        }
      } catch {
        // ignore
      }
      setTimeout(tick, 1500);
    };
    setTimeout(tick, 1500);
    return () => {
      stopped = true;
    };
  }, [state, router]);

  const buttonLabel =
    label ?? (scope === "all" ? "Scan all" : `Scan ${(scope as { ticker: string }).ticker}`);

  return (
    <Button
      onClick={trigger}
      disabled={state.kind === "running"}
      variant={state.kind === "error" ? "secondary" : "primary"}
      size="sm"
    >
      {state.kind === "running"
        ? state.progress.total
          ? `Scanning ${state.progress.done}/${state.progress.total}…`
          : "Scanning…"
        : state.kind === "error"
          ? state.message
          : buttonLabel}
    </Button>
  );
}
