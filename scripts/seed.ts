import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env.local");
} catch {
  // env already provided
}

async function main() {
  const { db } = await import("../src/db/index");
  const { seed } = await import("../src/db/seed");
  const { sql } = await import("drizzle-orm");
  const counts = await seed(db);
  console.log("Seeded:", counts);
  const byStatus = await db.execute(sql`select status, count(*)::int as n from purchase_orders group by status order by n desc`);
  console.table(byStatus);
  const lotStatus = await db.execute(sql`select status, count(*)::int as n from lots group by status order by n desc`);
  console.table(lotStatus);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
