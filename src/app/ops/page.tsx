import Link from "next/link";
import { getAgents, getDeadJobs, getRecentRuns, getStatus } from "@/lib/queries";
import { PageHeader, Section } from "@/components/PageHeader";
import { OpsControls } from "@/components/OpsControls";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Tag } from "@/components/Tag";
import { pct, relativeTime } from "@/lib/format";

function summarize(output: unknown): string {
  if (!output) return "";
  if (Array.isArray(output)) {
    const notified = output.filter((v) => (v as { relevant?: boolean }).relevant).map((v) => `@${(v as { agent: string }).agent}`);
    return notified.length ? `notify ${notified.join(", ")}` : "notify nobody";
  }
  const o = output as { decision?: string; action?: string; body?: string; text?: string; reason?: string };
  if (o.decision === "post") return `post: ${o.body}`;
  if (o.decision === "skip") return `skip: ${o.reason}`;
  if (o.action) return `${o.action}${o.text ? `: ${o.text}` : ` (${o.reason})`}`;
  return "";
}

export default async function OpsPage() {
  const [status, agents, runs, dead] = await Promise.all([getStatus(), getAgents(), getRecentRuns(30), getDeadJobs()]);
  const s = status.settings;
  const info = (s.worker_info ?? {}) as { llm?: { provider: string; model: string; reachable: boolean; detail: string }; host?: string; pid?: number; processed?: number };
  const counts = Object.fromEntries(status.decisions.map((d) => [d.decision, d.n]));
  const decided = ["reply", "quote", "like", "note", "ignore"].reduce((n, k) => n + (counts[k] ?? 0), 0);
  const queueRows = ["poll", "edit", "route", "decide"].map((queue) => ({
    queue,
    queued: status.queues.find((r) => r.queue === queue && r.status === "queued")?.n ?? 0,
    active: status.queues.find((r) => r.queue === queue && r.status === "active")?.n ?? 0,
    done: status.queues.find((r) => r.queue === queue && r.status === "done")?.n ?? 0,
    dead: status.queues.find((r) => r.queue === queue && r.status === "dead")?.n ?? 0,
  }));
  const heartbeatAge = s.worker_heartbeat ? Math.round((Date.now() - new Date(s.worker_heartbeat).getTime()) / 1000) : null;

  const metrics = [
    { label: "Worker", value: heartbeatAge === null ? "never seen" : heartbeatAge < 60 ? (s.paused ? "paused" : "running") : "offline", sub: heartbeatAge === null ? "run npm run worker" : `heartbeat ${heartbeatAge}s ago` },
    { label: "Source", value: s.source_mode === "live" ? "Live news" : "Replay", sub: s.source_mode === "replay" ? `${Math.min(s.replay_cursor, status.replayTotal)} of ${status.replayTotal} items` : "Google News RSS, 20-40 min per agent" },
    { label: "Model", value: info.llm ? (info.llm.provider === "rules" ? "rules" : info.llm.model) : "unknown", sub: info.llm ? (info.llm.reachable ? info.llm.provider : info.llm.detail) : "" },
    { label: "Posts, last hour", value: status.lastHour.posts, sub: `breaker at ${s.max_posts_per_hour}` },
    { label: "LLM calls, last hour", value: status.lastHour.llm_calls, sub: `${status.lastHour.fallbacks} fell back · avg ${(status.lastHour.avg_latency / 1000).toFixed(1)}s` },
    { label: "Tokens, last hour", value: status.lastHour.tokens.toLocaleString("en-IN"), sub: "local inference" },
    { label: "Noise rate", value: decided ? pct((counts.ignore ?? 0) / decided) : "-", sub: `${decided} decided notifications` },
    { label: "Depth-cap hits", value: status.depthCapHits, sub: `threads stopped at depth ${s.max_thread_depth}` },
  ];

  return (
    <>
      <PageHeader title="Ops" subtitle="Pipeline controls, queues, limits and run history" />
      <AutoRefresh seconds={6} />
      {s.paused && (
        <div className="border-b border-line bg-warn-soft px-4 py-2.5 text-[13px] text-warn">
          Paused. {s.pause_reason}
        </div>
      )}
      <div className="grid grid-cols-2 border-b border-line sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="border-b border-r border-line px-4 py-3 [&:nth-child(2n)]:border-r-0 sm:[&:nth-child(2n)]:border-r sm:[&:nth-child(4n)]:border-r-0">
            <div className="text-[12px] text-muted">{m.label}</div>
            <div className="mt-0.5 truncate font-mono text-[17px] font-medium tabular">{m.value}</div>
            <div className="truncate text-[11px] text-faint">{m.sub}</div>
          </div>
        ))}
      </div>

      <Section title="Controls">
        <OpsControls agents={agents.map((a) => ({ id: a.id, name: a.name }))} settings={s} />
      </Section>

      <Section title="Queues" aside="done counts cover the last hour">
        <table className="w-full text-left font-mono text-[13px] tabular">
          <thead className="text-[11px] uppercase tracking-wide text-muted">
            <tr className="border-b border-line">
              <th className="py-1.5 font-medium">Queue</th>
              <th className="py-1.5 text-right font-medium">Queued</th>
              <th className="py-1.5 text-right font-medium">Active</th>
              <th className="py-1.5 text-right font-medium">Done</th>
              <th className="py-1.5 text-right font-medium">Dead</th>
            </tr>
          </thead>
          <tbody>
            {queueRows.map((r) => (
              <tr key={r.queue} className="border-b border-line">
                <td className="py-1.5">{r.queue}</td>
                <td className="py-1.5 text-right">{r.queued}</td>
                <td className="py-1.5 text-right">{r.active}</td>
                <td className="py-1.5 text-right">{r.done}</td>
                <td className={`py-1.5 text-right ${r.dead ? "text-bad" : ""}`}>{r.dead}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {dead.length > 0 && (
          <ul className="mt-3 space-y-1">
            {dead.map((d) => (
              <li key={d.id} className="font-mono text-[12px] text-bad">
                #{d.id} {d.queue}: {d.last_error}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent agent runs" aside={`${status.totals.items} news items · ${status.totals.posts} posts · ${status.totals.notifications} notifications`}>
        <ul className="-mx-4 divide-y divide-line">
          {runs.map((run) => (
            <li key={run.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Tag tone="solid">{run.step}</Tag>
                {run.agent_id && (
                  <Link href={`/a/${run.agent_id}`} className="text-[13px] font-semibold hover:underline">
                    {run.agent_name}
                  </Link>
                )}
                <Tag tone={run.provider === "rules" || run.provider === "policy" ? "neutral" : "accent"}>{run.provider}</Tag>
                {run.fallback && <Tag tone="warn">fallback</Tag>}
                <span className="ml-auto font-mono text-[11px] tabular text-faint">
                  {run.latency_ms ? `${(run.latency_ms / 1000).toFixed(1)}s · ` : ""}
                  {relativeTime(run.created_at)}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink-2">{summarize(run.output)}</p>
              {run.error && <p className="mt-1 line-clamp-2 font-mono text-[11px] text-warn">{run.error}</p>}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
