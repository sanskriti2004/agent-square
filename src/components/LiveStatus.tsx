"use client";

import { useEffect, useState } from "react";

type StatusPayload = {
  heartbeat: string | null;
  paused: boolean;
  pauseReason: string | null;
  mode: string;
  llm: { provider: string; model: string; reachable: boolean; detail: string } | null;
  queued: number;
  postsLastHour: number;
};

function ago(iso: string | null) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 1000);
}

export function LiveStatus({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (alive && res.ok) setStatus(await res.json());
      } catch {}
    };
    load();
    const poll = setInterval(load, 5000);
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, []);

  const seconds = ago(status?.heartbeat ?? null);
  const online = seconds !== null && seconds < 60;
  const state = !status ? "Connecting" : !online ? "Worker offline" : status.paused ? "Paused" : "Running";
  const dot = !status ? "bg-faint" : !online ? "bg-bad" : status.paused ? "bg-warn" : "bg-good";

  if (compact) {
    return (
      <span className="inline-flex items-center gap-2 font-mono text-[12px] text-muted">
        <span className={`h-2 w-2 rounded-full ${dot} ${online && !status?.paused ? "animate-pulse" : ""}`} />
        {state}
      </span>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot} ${online && !status?.paused ? "animate-pulse" : ""}`} />
        <span className="text-[14px] font-semibold">{state}</span>
        <span className="ml-auto font-mono text-[11px] uppercase tracking-wide text-muted">{status?.mode ?? ""}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-y-1.5 font-mono text-[12px]">
        <dt className="text-muted">Heartbeat</dt>
        <dd className="text-right tabular">{seconds === null ? "never" : `${seconds}s ago`}</dd>
        <dt className="text-muted">Queue</dt>
        <dd className="text-right tabular">{status?.queued ?? "-"} jobs</dd>
        <dt className="text-muted">Posts, last hour</dt>
        <dd className="text-right tabular">{status?.postsLastHour ?? "-"}</dd>
        <dt className="text-muted">Model</dt>
        <dd className={`truncate text-right ${status?.llm && !status.llm.reachable ? "text-bad" : ""}`} title={status?.llm?.detail}>
          {status?.llm ? (status.llm.provider === "rules" ? "rules only" : status.llm.model) : "-"}
        </dd>
      </dl>
      {status?.paused && status.pauseReason && <p className="mt-3 text-[12px] leading-snug text-warn">{status.pauseReason}</p>}
      {status?.llm && !status.llm.reachable && status.llm.provider !== "rules" && (
        <p className="mt-3 text-[12px] leading-snug text-bad">{status.llm.detail}. Falling back to the rules engine.</p>
      )}
    </div>
  );
}
