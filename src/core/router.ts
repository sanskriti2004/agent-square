import { config, type LlmProviderName } from "@/lib/config";
import { generateJson } from "./llm";
import { JudgeSchema, PROMPT_VERSION, judgePrompt } from "./prompts";
import { priorReason, priorScore, rulesJudge, specificOverlap, strongestRelation } from "./rules";
import { edgeTypes, type Directory } from "./directory";
import type { Agent, Candidate, JudgeVerdict } from "./types";

export type RoutablePost = {
  authorId: string;
  body: string;
  sourceTitle: string | null;
  topics: string[];
  mentions: string[];
};

export function buildCandidates(
  post: RoutablePost,
  directory: Directory,
  options: { all?: boolean; limit?: number } = {},
): Candidate[] {
  const limit = options.limit ?? 10;
  const pool: Candidate[] = [];
  for (const agent of directory.agents) {
    if (agent.id === post.authorId || !agent.active) continue;
    const edges = directory.edgesFor(post.authorId, agent.id);
    const relation = strongestRelation(edgeTypes(edges));
    const mentioned = post.mentions.includes(agent.id);
    const overlap = specificOverlap(post.topics, agent.interest_tags);
    const via: string[] = [];
    if (mentioned) via.push("mention");
    if (relation !== "none") via.push(`graph:${relation}`);
    if (overlap.length) via.push("topic");
    if (!via.length && !options.all) continue;
    const edge = edges.find((e) => e.type === relation) ?? null;
    pool.push({
      agent,
      via: via.length ? via : ["all"],
      relation,
      edgeNote: edge?.note ?? null,
      overlap,
      mentioned,
      prior: priorScore({ mentioned, relation, overlap }),
    });
  }
  pool.sort((a, b) => b.prior - a.prior || a.agent.name.localeCompare(b.agent.name));
  return options.all ? pool : pool.slice(0, limit);
}

export type JudgeResult = {
  verdicts: Map<string, JudgeVerdict>;
  provider: LlmProviderName;
  model: string;
  fallback: boolean;
  error: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  promptVersion: string;
};

function normalizeScore(value: number) {
  const scaled = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, Number.isFinite(scaled) ? scaled : 0));
}

export type JudgeMode = "blend" | "llm";

export function blendScore(prior: number, llmScore: number) {
  return Number((0.5 * prior + 0.5 * llmScore).toFixed(2));
}

export async function judge(
  post: RoutablePost,
  author: Agent,
  candidates: Candidate[],
  threshold: number,
  provider: LlmProviderName = config.llmProvider,
  mode: JudgeMode = "blend",
): Promise<JudgeResult> {
  const fallbackVerdicts = new Map(rulesJudge(candidates, threshold).map((v) => [v.agent, v]));
  const base = {
    promptVersion: PROMPT_VERSION.judge,
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: 0,
  };
  if (!candidates.length) {
    return { ...base, verdicts: new Map(), provider: "rules", model: "rules-v1", fallback: false, error: null };
  }
  if (provider === "rules") {
    return { ...base, verdicts: fallbackVerdicts, provider: "rules", model: "rules-v1", fallback: false, error: null };
  }
  const prompt = judgePrompt({ author, body: post.body, sourceTitle: post.sourceTitle, topics: post.topics, candidates });
  const outcome = await generateJson({ ...prompt, schema: JudgeSchema, maxTokens: 120 + candidates.length * 70 }, provider);
  if (!outcome.ok) {
    return {
      ...base,
      verdicts: fallbackVerdicts,
      provider: outcome.provider,
      model: outcome.model,
      fallback: true,
      error: outcome.error,
      tokensIn: outcome.tokensIn,
      tokensOut: outcome.tokensOut,
      latencyMs: outcome.latencyMs,
    };
  }
  const verdicts = new Map<string, JudgeVerdict>();
  const missing: string[] = [];
  for (const candidate of candidates) {
    const found = outcome.data.decisions.find((d) => d.agent.replace(/^@/, "").toLowerCase() === candidate.agent.id);
    if (!found) {
      missing.push(candidate.agent.id);
      verdicts.set(candidate.agent.id, fallbackVerdicts.get(candidate.agent.id)!);
      continue;
    }
    const raw = normalizeScore(found.score);
    const llmScore = found.relevant ? raw : Math.min(raw, 0.3);
    const score = mode === "llm" ? llmScore : blendScore(candidate.prior, llmScore);
    const llmReason = found.reason.trim().slice(0, 200) || priorReason(candidate);
    verdicts.set(candidate.agent.id, {
      agent: candidate.agent.id,
      relevant: score >= threshold,
      score,
      relation: candidate.relation,
      reason: mode === "llm" ? llmReason : `${llmReason} (rules prior ${candidate.prior.toFixed(2)}, model ${llmScore.toFixed(2)})`,
    });
  }
  return {
    ...base,
    verdicts,
    provider: outcome.provider,
    model: outcome.model,
    fallback: missing.length > 0,
    error: missing.length ? `Judge omitted ${missing.join(", ")}; rules used for those` : null,
    tokensIn: outcome.tokensIn,
    tokensOut: outcome.tokensOut,
    latencyMs: outcome.latencyMs,
  };
}
