"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface AddTickerModalProps {
  open: boolean;
  onClose: () => void;
  onAdded?: (ticker: string) => void;
}

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export function AddTickerModal({ open, onClose, onAdded }: AddTickerModalProps) {
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const upper = ticker.trim().toUpperCase();
    if (!TICKER_RE.test(upper)) {
      setError("Invalid ticker symbol.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/tickers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticker: upper,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 5),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j?.data) throw new Error(j?.error?.message ?? "add failed");
      setTicker("");
      setTags("");
      onAdded?.(upper);
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 space-y-3"
      >
        <h2 className="text-base font-medium text-text">Add ticker</h2>
        <div className="space-y-1">
          <label className="text-xs text-text-muted">Symbol</label>
          <Input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="AAPL"
            autoFocus
            maxLength={10}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-text-muted">Tags (comma-separated, max 5)</label>
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="megacap, longterm"
          />
        </div>
        {error && <p className="text-xs text-sell">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} size="sm">
            Cancel
          </Button>
          <Button type="submit" disabled={submitting} size="sm">
            {submitting ? "Adding…" : "Add ticker"}
          </Button>
        </div>
      </form>
    </div>
  );
}
