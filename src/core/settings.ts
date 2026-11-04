import { one, q, type Queryable, pool } from "@/lib/db";
import type { Settings } from "./types";

export async function getSettings(db: Queryable = pool): Promise<Settings> {
  const row = await one<Settings>(`SELECT * FROM settings WHERE id = 1`, [], db);
  if (!row) throw new Error("settings row missing; run npm run db:setup");
  return row;
}

const EDITABLE = new Set([
  "paused",
  "pause_reason",
  "source_mode",
  "replay_interval_seconds",
  "notify_threshold",
  "originals_per_agent_day",
  "responses_per_agent_day",
  "max_thread_depth",
  "max_posts_per_hour",
  "max_llm_calls_per_hour",
]);

export async function updateSettings(patch: Partial<Settings>, db: Queryable = pool) {
  const entries = Object.entries(patch).filter(([key]) => EDITABLE.has(key));
  if (!entries.length) return;
  const sets = entries.map(([key], i) => `${key} = $${i + 1}`).join(", ");
  await q(`UPDATE settings SET ${sets}, updated_at = now() WHERE id = 1`, entries.map(([, v]) => v), db);
}

export async function pause(reason: string, db: Queryable = pool) {
  await q(`UPDATE settings SET paused = true, pause_reason = $1, updated_at = now() WHERE id = 1`, [reason], db);
}
