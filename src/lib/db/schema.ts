/**
 * Drizzle schema — Turso (libSQL).
 *
 * IDs are nanoid(16) strings. Timestamps stored as ISO 8601 text. Booleans
 * via integer { mode: "boolean" }. JSON columns via text { mode: "json" }.
 */

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";
import type { DirectionalSnapshot } from "@/engine/types";

const isoNow = () => new Date().toISOString();

// ── Auth.js standard tables ───────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  createdAt: text("createdAt").notNull().$defaultFn(isoNow),
});

export const accounts = sqliteTable(
  "accounts",
  {
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

export const sessions = sqliteTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verificationTokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);

// ── Watchlists ────────────────────────────────────────────────────────────

export const watchlists = sqliteTable("watchlists", {
  id: text("id").primaryKey().$defaultFn(() => nanoid(16)),
  name: text("name").notNull(),
  createdAt: text("createdAt").notNull().$defaultFn(isoNow),
});

export const watchlistTickers = sqliteTable(
  "watchlist_tickers",
  {
    watchlistId: text("watchlistId").notNull().references(() => watchlists.id),
    ticker: text("ticker").notNull(),
    tags: text("tags", { mode: "json" }).$type<string[]>().default([]),
    addedBy: text("addedBy").notNull().references(() => users.id),
    addedAt: text("addedAt").notNull().$defaultFn(isoNow),
    isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.watchlistId, t.ticker] }),
  }),
);

// ── Price cache ───────────────────────────────────────────────────────────

export const bars = sqliteTable(
  "bars",
  {
    ticker: text("ticker").notNull(),
    timeframe: text("timeframe", {
      enum: ["daily", "weekly", "monthly", "yearly"],
    }).notNull(),
    date: text("date").notNull(),
    open: real("open").notNull(),
    high: real("high").notNull(),
    low: real("low").notNull(),
    close: real("close").notNull(),
    volume: real("volume"),
    fetchedAt: text("fetchedAt").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ticker, t.timeframe, t.date] }),
    byTicker: index("bars_ticker_tf").on(t.ticker, t.timeframe),
  }),
);

// ── Signal state (latest per ticker × timeframe × indicator) ──────────────

export const signalStates = sqliteTable(
  "signal_states",
  {
    ticker: text("ticker").notNull(),
    timeframe: text("timeframe", {
      enum: ["daily", "weekly", "monthly", "yearly"],
    }).notNull(),
    indicator: text("indicator", { enum: ["sequential", "combo"] }).notNull(),
    direction: text("direction", { enum: ["buy", "sell"] }),
    phase: text("phase", { enum: ["none", "setup", "countdown"] })
      .notNull()
      .default("none"),
    count: integer("count").notNull().default(0),
    isPerfected: integer("isPerfected", { mode: "boolean" }).notNull().default(false),
    isDeferred: integer("isDeferred", { mode: "boolean" }).notNull().default(false),
    countdownBar8Close: real("countdownBar8Close"),
    tdstLevel: real("tdstLevel"),
    tdstAnchorBarDate: text("tdstAnchorBarDate"),
    riskLevel: real("riskLevel"),
    barsSince9: integer("barsSince9"),
    barsSince13: integer("barsSince13"),
    configHash: text("configHash").notNull(),
    engineStateJson: text("engineStateJson", { mode: "json" }).$type<DirectionalSnapshot>(),
    asOfBarDate: text("asOfBarDate").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ticker, t.timeframe, t.indicator] }),
  }),
);

// ── Immutable signal event log ────────────────────────────────────────────

export const signalEvents = sqliteTable(
  "signal_events",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid(16)),
    ticker: text("ticker").notNull(),
    timeframe: text("timeframe").notNull(),
    indicator: text("indicator").notNull(),
    eventType: text("eventType").notNull(),
    direction: text("direction", { enum: ["buy", "sell"] }),
    count: integer("count"),
    barDate: text("barDate").notNull(),
    firstKnownAtDate: text("firstKnownAtDate").notNull(),
    configHash: text("configHash").notNull(),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: text("createdAt").notNull().$defaultFn(isoNow),
  },
  (t) => ({
    byTickerTf: index("signal_events_ticker_tf").on(t.ticker, t.timeframe),
    byBarDate: index("signal_events_bar_date").on(t.barDate),
    byFirstKnown: index("signal_events_first_known").on(t.firstKnownAtDate),
    natural: index("signal_events_natural").on(
      t.ticker,
      t.timeframe,
      t.indicator,
      t.eventType,
      t.barDate,
    ),
  }),
);

// ── Alerts ────────────────────────────────────────────────────────────────

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey().$defaultFn(() => nanoid(16)),
  signalEventId: text("signalEventId").notNull().references(() => signalEvents.id),
  ticker: text("ticker").notNull(),
  timeframe: text("timeframe").notNull(),
  priority: text("priority", { enum: ["info", "warning", "critical"] }).notNull(),
  message: text("message").notNull(),
  dedupeKey: text("dedupeKey").notNull().unique(),
  createdAt: text("createdAt").notNull().$defaultFn(isoNow),
  readBy: text("readBy", { mode: "json" }).$type<string[]>().default([]),
});

// ── Hit-rate materialization ──────────────────────────────────────────────

export const signalHitRates = sqliteTable(
  "signal_hit_rates",
  {
    ticker: text("ticker").notNull(),
    timeframe: text("timeframe").notNull(),
    indicator: text("indicator").notNull(),
    signalType: text("signalType", {
      enum: ["setup_complete", "countdown_complete", "signal_9_13_9"],
    }).notNull(),
    n: integer("n").notNull(),
    hits: integer("hits").notNull(),
    avgReturnPct: real("avgReturnPct"),
    horizon: text("horizon").notNull(),
    lastComputedAt: text("lastComputedAt").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ticker, t.timeframe, t.indicator, t.signalType] }),
  }),
);

// ── Hero history (per-user) ───────────────────────────────────────────────

export const heroHistory = sqliteTable(
  "hero_history",
  {
    userId: text("userId").notNull().references(() => users.id),
    date: text("date").notNull(),
    ticker: text("ticker").notNull(),
    timeframe: text("timeframe").notNull(),
    indicator: text("indicator").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.date] }),
  }),
);

// ── Scan runs ─────────────────────────────────────────────────────────────

export const scanRuns = sqliteTable("scan_runs", {
  id: text("id").primaryKey().$defaultFn(() => nanoid(16)),
  trigger: text("trigger", { enum: ["cron", "manual", "add-ticker"] }).notNull(),
  triggeredBy: text("triggeredBy").references(() => users.id),
  startedAt: text("startedAt").notNull().$defaultFn(isoNow),
  finishedAt: text("finishedAt"),
  tickersAttempted: integer("tickersAttempted").notNull().default(0),
  tickersSucceeded: integer("tickersSucceeded").notNull().default(0),
  errors: text("errors", { mode: "json" })
    .$type<Array<{ ticker: string; message: string }>>()
    .default([]),
});

// Convenience: explicit CURRENT_TIMESTAMP usage if anything wants it.
export const currentTimestamp = sql`CURRENT_TIMESTAMP`;
