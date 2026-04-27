/**
 * Asia/Taipei boundary helpers.
 *
 * v1 is single-tenant for a small crew in TPE. The cron fires at
 * `0 22 * * *` UTC (06:00 Asia/Taipei). For most date math we use
 * `toZonedTime` from `date-fns-tz` to compute the local "today" the user
 * sees on the dashboard.
 */

import { toZonedTime } from "date-fns-tz";
import { format } from "date-fns";

const DEFAULT_TZ = "Asia/Taipei";

export function todayInTimezone(date = new Date(), timezone = DEFAULT_TZ): string {
  const zoned = toZonedTime(date, timezone);
  return format(zoned, "yyyy-MM-dd");
}

export function relativeTimeFrom(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
