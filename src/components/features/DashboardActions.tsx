"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ScanButton } from "./ScanButton";
import { AddTickerModal } from "./AddTickerModal";

export function DashboardActions() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Add ticker
      </Button>
      <ScanButton scope="all" />
      <AddTickerModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
