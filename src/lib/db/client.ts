/**
 * Drizzle client (Turso / libSQL).
 *
 * In production we connect to a remote Turso database. Locally, fall back
 * to a `file:./local.db` URL so dev workflows don't require a Turso token.
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const url = process.env.TURSO_DATABASE_URL ?? "file:./local.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient(authToken ? { url, authToken } : { url });

export const db = drizzle(client, { schema });
export { schema };
export type DB = typeof db;
