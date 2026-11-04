import { q, type Queryable, pool } from "@/lib/db";

export type QueueName = "poll" | "edit" | "route" | "decide";

export type Job = {
  id: string;
  queue: QueueName;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

export async function enqueue(
  queue: QueueName,
  payload: Record<string, unknown>,
  options: { priority?: number; delaySeconds?: number; singletonKey?: string } = {},
  db: Queryable = pool,
) {
  await q(
    `INSERT INTO jobs (queue, payload, priority, run_at, singleton_key)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5)
     ON CONFLICT DO NOTHING`,
    [queue, payload, options.priority ?? 0, options.delaySeconds ?? 0, options.singletonKey ?? null],
    db,
  );
}

export async function claim(limit = 1): Promise<Job[]> {
  return q<Job>(
    `UPDATE jobs SET status = 'active', locked_at = now(), attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM jobs
       WHERE status = 'queued' AND run_at <= now()
       ORDER BY priority DESC, run_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, queue, payload, attempts, max_attempts`,
    [limit],
  );
}

export async function complete(id: string) {
  await q(`UPDATE jobs SET status = 'done', finished_at = now() WHERE id = $1`, [id]);
}

export async function fail(job: Job, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const dead = job.attempts >= job.max_attempts;
  await q(
    `UPDATE jobs
     SET status = $2, last_error = $3, locked_at = NULL,
         run_at = now() + make_interval(secs => $4),
         finished_at = CASE WHEN $2 = 'dead' THEN now() ELSE NULL END
     WHERE id = $1`,
    [job.id, dead ? "dead" : "queued", message.slice(0, 2000), 15 * 2 ** job.attempts],
  );
}

export async function recoverStale(minutes = 10) {
  await q(
    `UPDATE jobs SET status = 'queued', locked_at = NULL
     WHERE status = 'active' AND locked_at < now() - make_interval(mins => $1)`,
    [minutes],
  );
}
