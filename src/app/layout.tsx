import "@/styles/globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { auth } from "@/server/auth";
import { TopNav } from "@/components/layout/TopNav";

export const metadata: Metadata = {
  title: "DM — DeMark Signal Monitor",
  description:
    "Public-source DeMark-style approximation. Tracks TD Sequential + Combo across daily/weekly/monthly/yearly bars on a shared watchlist.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text">
        <TopNav user={session?.user ?? undefined} />
        <main className="mx-auto max-w-screen-xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
