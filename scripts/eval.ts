import "@/lib/env";
import { readFileSync, writeFileSync } from "node:fs";
import { pool } from "@/lib/db";
import { config } from "@/lib/config";
import { loadDirectory, edgeTypes } from "@/core/directory";
import { blendScore, buildCandidates, judge, type RoutablePost } from "@/core/router";
import { rulesJudge, specificOverlap, strongestRelation } from "@/core/rules";
import { findMentions } from "@/core/vocab";
import { llmHealth } from "@/core/llm";

type Case = { id: string; author: string; body: string; topics: string[]; notify: string[]; why: string };
type StrategyResult = { name: string; description: string; tp: number; fp: number; fn: number; tn: number; precision: number; recall: number; f1: number; seconds: number; errors: string[]; perCase: { id: string; predicted: string[]; fp: string[]; fn: string[] }[] };

const THRESHOLD = 0.6;

function score(name: string, description: string, predictions: Map<string, Set<string>>, cases: Case[], others: (c: Case) => string[], seconds: number, errors: string[]): StrategyResult {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const perCase = cases.map((c) => {
    const predicted = predictions.get(c.id) ?? new Set<string>();
    const truth = new Set(c.notify);
    const caseFp: string[] = [];
    const caseFn: string[] = [];
    for (const agent of others(c)) {
      const p = predicted.has(agent);
      const t = truth.has(agent);
      if (p && t) tp++;
      else if (p && !t) { fp++; caseFp.push(agent); }
      else if (!p && t) { fn++; caseFn.push(agent); }
      else tn++;
    }
    return { id: c.id, predicted: [...predicted], fp: caseFp, fn: caseFn };
  });
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { name, description, tp, fp, fn, tn, precision, recall, f1, seconds, errors, perCase };
}

async function main() {
  const file = JSON.parse(readFileSync("data/eval/routing-cases.json", "utf8")) as { cases: Case[] };
  const cases = file.cases;
  const directory = await loadDirectory();
  const others = (c: Case) => directory.agents.filter((a) => a.id !== c.author).map((a) => a.id);
  const toPost = (c: Case): RoutablePost => ({
    authorId: c.author,
    body: c.body,
    sourceTitle: null,
    topics: c.topics,
    mentions: findMentions(c.body, directory.agents, c.author),
  });
  const results: StrategyResult[] = [];
  const skipLlm = process.argv.includes("--rules-only");
  const skipAll = process.argv.includes("--skip-all");

  const timed = async (fn: () => Promise<Map<string, Set<string>>>) => {
    const started = Date.now();
    const map = await fn();
    return { map, seconds: (Date.now() - started) / 1000 };
  };

  {
    const { map, seconds } = await timed(async () => new Map(cases.map((c) => [c.id, new Set(toPost(c).mentions)])));
    results.push(score("mentions-only", "Notify only agents named in the post.", map, cases, others, seconds, []));
  }
  {
    const { map, seconds } = await timed(async () =>
      new Map(cases.map((c) => [c.id, new Set([...toPost(c).mentions, ...others(c).filter((id) => strongestRelation(edgeTypes(directory.edgesFor(c.author, id))) !== "none")])])),
    );
    results.push(score("graph-only", "Notify every 1-hop relationship neighbour of the author.", map, cases, others, seconds, []));
  }
  {
    const { map, seconds } = await timed(async () =>
      new Map(cases.map((c) => [c.id, new Set([...toPost(c).mentions, ...directory.agents.filter((a) => a.id !== c.author && specificOverlap(c.topics, a.interest_tags).length > 0).map((a) => a.id)])])),
    );
    results.push(score("topic-only", "Notify every agent whose interests overlap the post topics.", map, cases, others, seconds, []));
  }
  {
    const { map, seconds } = await timed(async () =>
      new Map(
        cases.map((c) => {
          const post = toPost(c);
          const candidates = buildCandidates(post, directory);
          const verdicts = rulesJudge(candidates, THRESHOLD);
          return [c.id, new Set([...post.mentions, ...verdicts.filter((v) => v.relevant).map((v) => v.agent)])];
        }),
      ),
    );
    results.push(score("hybrid-rules", "Candidates (mentions, graph, topics) scored by the deterministic rules prior. Production default.", map, cases, others, seconds, []));
  }

  const health = await llmHealth();
  if (!skipLlm && health.reachable && config.llmProvider !== "rules") {
    const runLlm = async (name: string, description: string, all: boolean, blendName?: string, blendDescription?: string) => {
      const errors: string[] = [];
      const started = Date.now();
      const pure = new Map<string, Set<string>>();
      const blended = new Map<string, Set<string>>();
      for (const c of cases) {
        const post = toPost(c);
        const author = directory.byId.get(c.author)!;
        const candidates = buildCandidates(post, directory, { all });
        const result = await judge(post, author, candidates, THRESHOLD, config.llmProvider, "llm");
        if (result.error) errors.push(`${c.id}: ${result.error}`);
        const llmPicks = [...result.verdicts.values()].filter((v) => v.relevant).map((v) => v.agent);
        pure.set(c.id, new Set([...post.mentions, ...llmPicks]));
        const blendPicks = candidates
          .filter((cand) => blendScore(cand.prior, result.verdicts.get(cand.agent.id)?.score ?? 0) >= THRESHOLD)
          .map((cand) => cand.agent.id);
        blended.set(c.id, new Set([...post.mentions, ...blendPicks]));
        process.stdout.write(".");
      }
      process.stdout.write("\n");
      const seconds = (Date.now() - started) / 1000;
      results.push(score(name, description, pure, cases, others, seconds, errors));
      if (blendName && blendDescription) results.push(score(blendName, blendDescription, blended, cases, others, seconds, errors));
    };
    await runLlm(
      "hybrid-llm",
      `Candidates (mentions, graph, topics) judged by ${health.model} alone.`,
      false,
      "hybrid-blend",
      `Candidates scored 50/50 by the rules prior and ${health.model}.`,
    );
    if (!skipAll) await runLlm("llm-all", `Every agent judged by ${health.model}, no candidate stage.`, true);
  } else if (!skipLlm) {
    console.log(`LLM strategies skipped: ${health.detail}`);
  }

  const pairs = cases.reduce((n, c) => n + others(c).length, 0);
  const positives = cases.reduce((n, c) => n + c.notify.length, 0);
  console.log(`\n${cases.length} posts, ${pairs} labelled (post, agent) pairs, ${positives} positives\n`);
  console.log("strategy        precision  recall   f1     tp  fp  fn  seconds");
  for (const r of results) {
    console.log(
      `${r.name.padEnd(15)} ${r.precision.toFixed(2).padStart(9)}  ${r.recall.toFixed(2).padStart(6)}  ${r.f1.toFixed(2).padStart(5)}  ${String(r.tp).padStart(3)} ${String(r.fp).padStart(3)} ${String(r.fn).padStart(3)}  ${r.seconds.toFixed(1).padStart(7)}`,
    );
  }
  writeFileSync(
    "data/eval/results.json",
    `${JSON.stringify({ ranAt: new Date().toISOString(), model: health.model, provider: health.provider, threshold: THRESHOLD, cases: cases.length, pairs, positives, results }, null, 2)}\n`,
  );
  console.log("\nwrote data/eval/results.json");
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
