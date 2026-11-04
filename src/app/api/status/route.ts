import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await one<{
    worker_heartbeat: string | null;
    paused: boolean;
    pause_reason: string | null;
    source_mode: string;
    worker_info: { llm?: { provider: string; model: string; reachable: boolean; detail: string } } | null;
  }>(`SELECT worker_heartbeat, paused, pause_reason, source_mode, worker_info FROM settings WHERE id = 1`);
  const counts = await one<{ queued: number; posts: number }>(
    `SELECT (SELECT count(*) FROM jobs WHERE status IN ('queued', 'active'))::int AS queued,
            (SELECT count(*) FROM posts WHERE created_at > now() - interval '1 hour')::int AS posts`,
  );
  return Response.json({
    heartbeat: settings?.worker_heartbeat ?? null,
    paused: settings?.paused ?? false,
    pauseReason: settings?.pause_reason ?? null,
    mode: settings?.source_mode ?? "live",
    llm: settings?.worker_info?.llm ?? null,
    queued: counts?.queued ?? 0,
    postsLastHour: counts?.posts ?? 0,
  });
}
