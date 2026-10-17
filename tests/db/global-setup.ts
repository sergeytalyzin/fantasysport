import EmbeddedPostgres from "embedded-postgres";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type { TestProject } from "vitest/node";

const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, ".pgdata");
const PORT = 54329;
export const TEMPLATE_DB = "pickup_template";

declare module "vitest" {
  export interface ProvidedContext {
    pgUrl: string;
  }
}

async function applyMigrations(client: pg.Client) {
  await client.query(await readFile(path.join(__dirname, "supabase-stub.sql"), "utf8"));
  const dir = path.join(ROOT, "supabase/migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    try {
      await client.query(await readFile(path.join(dir, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
}

export default async function setup(project: TestProject) {
  await rm(DATA_DIR, { recursive: true, force: true });
  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
    onLog: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase(TEMPLATE_DB);

  const baseUrl = `postgres://postgres:postgres@localhost:${PORT}`;
  const client = new pg.Client({ connectionString: `${baseUrl}/${TEMPLATE_DB}` });
  await client.connect();
  try {
    await applyMigrations(client);
  } finally {
    await client.end();
  }

  project.provide("pgUrl", baseUrl);

  return async () => {
    await server.stop();
    await rm(DATA_DIR, { recursive: true, force: true });
  };
}
