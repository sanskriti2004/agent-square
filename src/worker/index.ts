import "@/lib/env";
import { hostname } from "node:os";
import { pool, q } from "@/lib/db";
import { claim, complete, fail, recoverStale, type Job } from "@/core/queue";
import { handleDecide, handleEdit, handlePoll, handleRoute, ingestItem } from "@/core/pipeline";
import { getSettings, pause } from "@/core/settings";
import { replayItems } from "@/core/replay";
import { llmHealth } from "@/core/llm";
import { enqueue } from "@/core/queue";

const TICK_MS = 1500;
const SCHEDULE_EVERY_MS = 15000;
let lastSchedule = 0;
let processed = 0;
let stopping = false;

function log(message: string, extra: Record<string, unknown> = {}) {
  const detail = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
  console.log(`${new Date().toISOString()} ${message}${detail}`);
}

async function heartbeat(state: string) {
  const health = await llmHealth();
  await q(`UPDATE settings SET worker_heartbeat = now(), worker_info = $1 WHERE id = 1`, [
    JSON.stringify({ host: hostname(), pid: process.pid, state, processed, llm: health }),
  ]);
}

async function circuitBreaker() {
  const settings = await getSettings();
  const rows = await q<{ n: string }>(`SELECT count(*) AS n FROM posts WHERE created_at > now() - interval '1 hour'`);
  const posts = Number(rows[0]?.n ?? 0);
  if (posts >= settings.max_posts_per_hour) {
    await pause(`Circuit breaker: ${posts} posts in the last hour (limit ${settings.max_posts_per_hour}).`);
    log("circuit breaker tripped", { posts });
    return true;
  }
  return false;
}

async function schedule() {
  const settings = await getSettings();
  if (settings.paused) return;
  if (settings.source_mode === "live") {
    const due = await q<{ id: string }>(
      `UPDATE agents SET next_poll_at = now() + make_interval(mins => $1::int + floor(random() * ($2::int - $1::int + 1))::int)
       WHERE id IN (SELECT id FROM agents WHERE active AND next_poll_at <= now() ORDER BY next_poll_at LIMIT 2)
       RETURNING id`,
      [settings.poll_min_minutes, settings.poll_max_minutes],
    );
    for (const agent of due) await enqueue("poll", { agentId: agent.id }, { priority: 1, singletonKey: `poll:${agent.id}` });
    return;
  }
  if (new Date(settings.next_replay_at).getTime() > Date.now()) return;
  const items = replayItems();
  if (!items.length || settings.replay_cursor >= items.length) return;
  const item = items[settings.replay_cursor];
  await q(
    `UPDATE settings SET replay_cursor = replay_cursor + 1, next_replay_at = now() + make_interval(secs => replay_interval_seconds) WHERE id = 1`,
  );
  const result = await ingestItem({
    agentId: item.agentId,
    origin: item.origin,
    url: item.url,
    title: item.title,
    publisher: item.publisher,
    publishedAt: item.publishedAt,
  });
  log("replay item", { cursor: settings.replay_cursor, agent: item.agentId, queued: result.queued });
}

async function run(job: Job) {
  const payload = job.payload as Record<string, string & boolean>;
  if (job.queue === "poll") return handlePoll({ agentId: payload.agentId });
  if (job.queue === "edit") return handleEdit({ itemId: payload.itemId, force: Boolean(payload.force) });
  if (job.queue === "route") return handleRoute({ postId: payload.postId });
  if (job.queue === "decide") return handleDecide({ notificationId: payload.notificationId });
}

async function loop() {
  log("worker started", { pid: process.pid });
  await recoverStale(0);
  while (!stopping) {
    try {
      const settings = await getSettings();
      if (Date.now() - lastSchedule > SCHEDULE_EVERY_MS) {
        lastSchedule = Date.now();
        await heartbeat(settings.paused ? "paused" : "running");
        await recoverStale(10);
        await schedule();
      }
      if (settings.paused) {
        await new Promise((r) => setTimeout(r, TICK_MS * 2));
        continue;
      }
      const [job] = await claim(1);
      if (!job) {
        await new Promise((r) => setTimeout(r, TICK_MS));
        continue;
      }
      if ((job.queue === "edit" || job.queue === "decide") && (await circuitBreaker())) {
        await q(`UPDATE jobs SET status = 'queued', locked_at = NULL, attempts = attempts - 1 WHERE id = $1`, [job.id]);
        continue;
      }
      const started = Date.now();
      try {
        await run(job);
        await complete(job.id);
        processed++;
        log(`done ${job.queue}`, { id: job.id, ms: Date.now() - started });
      } catch (error) {
        await fail(job, error);
        log(`failed ${job.queue}`, { id: job.id, error: error instanceof Error ? error.message : String(error) });
      }
    } catch (error) {
      log("loop error", { error: error instanceof Error ? error.message : String(error) });
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await heartbeat("stopped").catch(() => undefined);
  await pool.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log(`received ${signal}, finishing current job`);
    stopping = true;
  });
}

loop();
