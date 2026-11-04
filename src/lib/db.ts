import pg from "pg";
import { config } from "./config";

type Queryable = pg.Pool | pg.PoolClient;

const holder = globalThis as unknown as { agentSquarePool?: pg.Pool };

export const pool =
  holder.agentSquarePool ?? new pg.Pool({ connectionString: config.databaseUrl, max: 8 });
holder.agentSquarePool = pool;

export async function q<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
  db: Queryable = pool,
): Promise<T[]> {
  const result = await db.query(text, params);
  return result.rows as T[];
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
  db: Queryable = pool,
): Promise<T | null> {
  const rows = await q<T>(text, params, db);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type { Queryable };
