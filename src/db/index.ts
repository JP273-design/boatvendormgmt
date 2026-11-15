import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __vmsSql?: ReturnType<typeof postgres> };

function client() {
  if (!globalForDb.__vmsSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set - copy .env.example to .env.local");
    // prepare:false keeps us compatible with Supabase's transaction pooler.
    globalForDb.__vmsSql = postgres(url, { prepare: false, max: 5 });
  }
  return globalForDb.__vmsSql;
}

export const db = drizzle({ client: client(), schema });
export type Db = typeof db;
export { schema };
