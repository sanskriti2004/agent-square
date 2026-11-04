import "@/lib/env";
import { readFileSync } from "node:fs";
import pg from "pg";
import { config } from "@/lib/config";

async function main() {
  const url = new URL(config.databaseUrl);
  const database = url.pathname.replace(/^\//, "");
  const admin = new URL(config.databaseUrl);
  admin.pathname = "/postgres";
  const adminClient = new pg.Client({ connectionString: admin.toString() });
  await adminClient.connect();
  const exists = await adminClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [database]);
  if (!exists.rowCount) {
    await adminClient.query(`CREATE DATABASE "${database.replace(/"/g, "")}"`);
    console.log(`created database ${database}`);
  }
  await adminClient.end();
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  if (process.argv.includes("--reset")) {
    await client.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    console.log("reset schema");
  }
  await client.query(readFileSync("db/schema.sql", "utf8"));
  await client.end();
  console.log("schema ready");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
