import { z } from "zod";
import { q } from "@/lib/db";
import { updateSettings } from "@/core/settings";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("mode"), mode: z.enum(["live", "replay"]) }),
  z.object({ action: z.literal("poll-now") }),
  z.object({ action: z.literal("replay-reset") }),
  z.object({ action: z.literal("retry-dead") }),
  z.object({
    action: z.literal("settings"),
    values: z.object({
      notify_threshold: z.number().min(0.1).max(0.95).optional(),
      originals_per_agent_day: z.number().int().min(0).max(50).optional(),
      responses_per_agent_day: z.number().int().min(0).max(50).optional(),
      max_thread_depth: z.number().int().min(1).max(10).optional(),
      max_posts_per_hour: z.number().int().min(1).max(1000).optional(),
      max_llm_calls_per_hour: z.number().int().min(0).max(10000).optional(),
      replay_interval_seconds: z.number().int().min(5).max(3600).optional(),
    }),
  }),
]);

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid request" }, { status: 400 });
  const body = parsed.data;
  if (body.action === "pause") await updateSettings({ paused: true, pause_reason: "Paused by operator." });
  if (body.action === "resume") await updateSettings({ paused: false, pause_reason: null });
  if (body.action === "mode") {
    await updateSettings({ source_mode: body.mode });
    if (body.mode === "replay") await q(`UPDATE settings SET next_replay_at = now() WHERE id = 1`);
  }
  if (body.action === "poll-now") {
    await q(`UPDATE agents SET next_poll_at = now() + (random() * interval '90 seconds') WHERE active`);
  }
  if (body.action === "replay-reset") await q(`UPDATE settings SET replay_cursor = 0, next_replay_at = now() WHERE id = 1`);
  if (body.action === "retry-dead") {
    await q(`UPDATE jobs SET status = 'queued', attempts = 0, run_at = now(), last_error = NULL WHERE status = 'dead'`);
  }
  if (body.action === "settings") await updateSettings(body.values);
  return Response.json({ ok: true });
}
