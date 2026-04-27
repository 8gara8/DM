/**
 * Standard JSON envelope helpers for API routes.
 *
 * All non-cron routes wrap their payloads with `ok()` / `err()` so the
 * client only needs one parser per response.
 */

import { NextResponse } from "next/server";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PROVIDER_ERROR"
  | "INTERNAL"
  | "METHOD_NOT_ALLOWED";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data, error: null }, { status });
}

export function err(
  code: ErrorCode,
  message: string,
  status = 400,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    { data: null, error: { code, message, ...(extra ?? {}) } },
    { status },
  );
}

const STATUS_MAP: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PROVIDER_ERROR: 502,
  INTERNAL: 500,
  METHOD_NOT_ALLOWED: 405,
};

export function statusFor(code: ErrorCode): number {
  return STATUS_MAP[code];
}

/** Wrap an async handler so thrown errors land in the standard envelope. */
export function withErrors(
  handler: (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<NextResponse>,
) {
  return async (
    req: Request,
    ctx?: { params: Promise<Record<string, string>> },
  ) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[api]", message, e);
      return err("INTERNAL", message, 500);
    }
  };
}
