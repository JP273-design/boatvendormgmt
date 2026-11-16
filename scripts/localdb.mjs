// Local demo database. Runs a real Postgres inside this project folder (./.localdb).
// Start it with: npm run db:local   (leave that window open while you use the app)
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const PORT = 54329;
const DIR = "./.localdb";

const pg = new EmbeddedPostgres({
  databaseDir: DIR,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
});

if (!existsSync(`${DIR}/PG_VERSION`)) {
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase("vms");
} catch {
  // already exists
}
console.log(`Local database running: postgres://postgres:postgres@localhost:${PORT}/vms`);
console.log("Leave this window open. Press Ctrl+C to stop.");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
