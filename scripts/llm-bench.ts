import "@/lib/env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pool } from "@/lib/db";
import { config } from "@/lib/config";
import { generateJson } from "@/core/llm";
import { DecideSchema, EditorSchema, decidePrompt, editorPrompt } from "@/core/prompts";
import { loadDirectory } from "@/core/directory";
import { buildCandidates, judge } from "@/core/router";
import { validateBody } from "@/core/validator";
import { findMentions } from "@/core/vocab";

type Row = { task: string; ok: boolean; valid: boolean | null; ms: number; detail: string };
type Case = { id: string; author: string; body: string; topics: string[]; notify: string[] };

function pct(n: number, d: number) {
  return d ? `${Math.round((100 * n) / d)}%` : "n/a";
}

function p50(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function benchModel(model: string) {
  config.ollamaModel = model;
  const directory = await loadDirectory();
  const handles = new Set(directory.agents.map((a) => a.id));
  const snapshot = JSON.parse(readFileSync("data/replay/snapshot.json", "utf8")) as { agentId: string; title: string; publisher: string | null; publishedAt: string | null }[];
  const cases = (JSON.parse(readFileSync("data/eval/routing-cases.json", "utf8")) as { cases: Case[] }).cases;
  const rows: Row[] = [];
  await generateJson({ system: "Reply with JSON.", user: "Return {\"decision\":\"skip\",\"reason\":\"warmup\",\"body\":\"\",\"topics\":[],\"mentions\":[]}", schema: EditorSchema }, "ollama");

  for (const item of snapshot.slice(0, 12)) {
    const agent = directory.byId.get(item.agentId)!;
    const prompt = editorPrompt({ agent, agents: directory.agents, title: item.title, publisher: item.publisher, publishedAt: item.publishedAt, recent: [] });
    const out = await generateJson({ ...prompt, schema: EditorSchema, maxTokens: 300 }, "ollama");
    if (!out.ok) {
      rows.push({ task: "editor", ok: false, valid: null, ms: out.latencyMs, detail: out.error });
      continue;
    }
    const valid = out.data.decision === "post" ? validateBody(out.data.body, { knownHandles: handles }) : null;
    rows.push({
      task: "editor",
      ok: true,
      valid: valid ? valid.ok : null,
      ms: out.latencyMs,
      detail: `${out.data.decision}: ${out.data.decision === "post" ? out.data.body : out.data.reason}${valid && !valid.ok ? ` [rejected: ${valid.errors.join("; ")}]` : ""}`,
    });
  }

  let tp = 0, fp = 0, fn = 0;
  for (const c of cases.slice(0, 8)) {
    const author = directory.byId.get(c.author)!;
    const post = { authorId: c.author, body: c.body, sourceTitle: null, topics: c.topics, mentions: findMentions(c.body, directory.agents, c.author) };
    const candidates = buildCandidates(post, directory);
    const result = await judge(post, author, candidates, 0.6, "ollama");
    const predicted = new Set([...post.mentions, ...[...result.verdicts.values()].filter((v) => v.relevant).map((v) => v.agent)]);
    for (const cand of candidates) {
      const truth = c.notify.includes(cand.agent.id);
      const p = predicted.has(cand.agent.id);
      if (p && truth) tp++;
      if (p && !truth) fp++;
      if (!p && truth) fn++;
    }
    rows.push({ task: "judge", ok: !result.fallback, valid: null, ms: result.latencyMs, detail: `${c.id}: ${[...predicted].join(", ") || "none"}${result.error ? ` (${result.error})` : ""}` });
  }

  for (const c of cases.filter((x) => x.notify.length).slice(0, 8)) {
    const agent = directory.byId.get(c.notify[0])!;
    const author = directory.byId.get(c.author)!;
    const prompt = decidePrompt({ agent, author, body: c.body, reason: "Routed by relevance judge", relation: null, score: 0.8, depth: 0, allowWrite: true, recent: [] });
    const out = await generateJson({ ...prompt, schema: DecideSchema, maxTokens: 220 }, "ollama");
    if (!out.ok) {
      rows.push({ task: "decide", ok: false, valid: null, ms: out.latencyMs, detail: out.error });
      continue;
    }
    const writes = out.data.action === "reply" || out.data.action === "quote";
    const valid = writes ? validateBody(out.data.text, { knownHandles: handles, maxLength: 240 }) : null;
    rows.push({ task: "decide", ok: true, valid: valid ? valid.ok : null, ms: out.latencyMs, detail: `@${agent.id} ${out.data.action}: ${out.data.text || out.data.reason}${valid && !valid.ok ? ` [rejected: ${valid.errors.join("; ")}]` : ""}` });
  }

  const summary = ["editor", "judge", "decide"].map((task) => {
    const list = rows.filter((r) => r.task === task);
    const checked = list.filter((r) => r.valid !== null);
    return {
      task,
      calls: list.length,
      schemaOk: pct(list.filter((r) => r.ok).length, list.length),
      validatorPass: pct(checked.filter((r) => r.valid).length, checked.length),
      p50ms: p50(list.map((r) => r.ms)),
    };
  });
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  return { model, summary, judge: { precision, recall }, rows };
}

async function main() {
  const models = process.argv.slice(2).length ? process.argv.slice(2) : [config.ollamaModel];
  const results = [];
  for (const model of models) {
    console.log(`benchmarking ${model}`);
    results.push(await benchModel(model));
  }
  const lines = [
    "# Model Benchmark Results",
    "",
    `Generated by \`npm run llm:bench\` on ${new Date().toISOString()} using Ollama at ${config.ollamaUrl}, with the prompts and schemas in \`src/core/prompts.ts\`. Analysis is in [evaluation.md](../evaluation.md#2-model-selection).`,
    "",
    "| Model | Task | Calls | Schema-valid JSON | Validator pass (writes) | p50 latency |",
    "|---|---|---|---|---|---|",
    ...results.flatMap((r) => r.summary.map((s) => `| ${r.model} | ${s.task} | ${s.calls} | ${s.schemaOk} | ${s.validatorPass} | ${(s.p50ms / 1000).toFixed(1)} s |`)),
    "",
    "| Model | Judge precision (candidates, 8 posts) | Judge recall |",
    "|---|---|---|",
    ...results.map((r) => `| ${r.model} | ${r.judge.precision.toFixed(2)} | ${r.judge.recall.toFixed(2)} |`),
    "",
    ...results.flatMap((r) => [`## Raw outputs: ${r.model}`, "", ...r.rows.map((row) => `- **${row.task}** (${(row.ms / 1000).toFixed(1)} s) ${row.detail.replace(/\n/g, " ")}`), ""]),
  ];
  mkdirSync("docs/benchmarks", { recursive: true });
  writeFileSync("docs/benchmarks/model-benchmark.md", `${lines.join("\n")}\n`);
  console.log(lines.slice(0, 20).join("\n"));
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
