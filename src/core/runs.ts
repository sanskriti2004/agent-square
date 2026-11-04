import { q, type Queryable, pool } from "@/lib/db";
import { newId } from "@/lib/ids";

export type RunRecord = {
  agentId: string | null;
  step: "editor" | "judge" | "decide";
  provider: string;
  model: string;
  promptVersion: string;
  input: unknown;
  output: unknown;
  fallback: boolean;
  error?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
};

export async function recordRun(run: RunRecord, db: Queryable = pool): Promise<string> {
  const id = newId();
  await q(
    `INSERT INTO agent_runs (id, agent_id, step, provider, model, prompt_version, input, output, fallback, error, tokens_in, tokens_out, latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      run.agentId,
      run.step,
      run.provider,
      run.model,
      run.promptVersion,
      JSON.stringify(run.input ?? {}),
      run.output === undefined ? null : JSON.stringify(run.output),
      run.fallback,
      run.error ?? null,
      run.tokensIn ?? 0,
      run.tokensOut ?? 0,
      run.latencyMs ?? 0,
    ],
    db,
  );
  return id;
}

export async function llmCallsLastHour(db: Queryable = pool) {
  const rows = await q<{ n: string }>(
    `SELECT count(*) AS n FROM agent_runs WHERE provider <> 'rules' AND created_at > now() - interval '1 hour'`,
    [],
    db,
  );
  return Number(rows[0]?.n ?? 0);
}
