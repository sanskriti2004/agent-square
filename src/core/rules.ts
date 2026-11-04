import { extractTopics, findMentions, sensitiveMatch } from "./vocab";
import type { Agent, Candidate, JudgeVerdict, RelationType } from "./types";
import type { DecideOutput, EditorOutput } from "./prompts";

export const GENERIC_TOPICS = new Set([
  "partnership",
  "funding",
  "ipo",
  "earnings",
  "leadership",
  "regulation",
  "ai",
  "advertising",
  "pricing",
]);

const EDGE_BONUS: Record<RelationType, number> = {
  partner: 0.2,
  competitor: 0.2,
  same_parent: 0.2,
  supplier: 0.15,
  adjacent: 0.1,
};

const EDGE_PRIORITY: RelationType[] = ["same_parent", "partner", "supplier", "competitor", "adjacent"];

export function strongestRelation(types: RelationType[]): RelationType | "none" {
  return EDGE_PRIORITY.find((t) => types.includes(t)) ?? "none";
}

export function specificOverlap(topics: string[], interests: string[]) {
  const wanted = new Set(interests);
  return [...new Set(topics)].filter((t) => wanted.has(t) && !GENERIC_TOPICS.has(t));
}

export function priorScore(input: { mentioned: boolean; relation: RelationType | "none"; overlap: string[] }) {
  if (input.mentioned) return 0.95;
  const bonus = input.relation === "none" ? 0 : EDGE_BONUS[input.relation];
  if (input.overlap.length === 0) return input.relation === "none" ? 0 : 0.25;
  const base = 0.45 + 0.1 * Math.min(input.overlap.length - 1, 2);
  return Math.min(0.9, Number((base + bonus).toFixed(2)));
}

export function priorReason(c: Pick<Candidate, "mentioned" | "relation" | "overlap" | "edgeNote">) {
  if (c.mentioned) return "Named directly in the post.";
  const relation = c.relation === "none" ? null : c.relation.replace("_", " ");
  if (c.overlap.length && relation) return `${capitalize(relation)} of the author; post covers ${c.overlap.join(", ")}.`;
  if (c.overlap.length) return `Post covers ${c.overlap.join(", ")}, which this company follows.`;
  if (relation) return `${capitalize(relation)} of the author, but this post is outside the shared business.`;
  return "No connection to this post.";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function rulesJudge(candidates: Candidate[], threshold: number): JudgeVerdict[] {
  return candidates.map((c) => ({
    agent: c.agent.id,
    relevant: c.prior >= threshold,
    score: c.prior,
    relation: c.relation,
    reason: priorReason(c),
  }));
}

const LEADS = ["In the news:", "Update:", "Worth a read:"];

export function rulesEditor(input: { agent: Agent; agents: Agent[]; title: string; seed: number }): EditorOutput {
  const { agent, title } = input;
  const sensitive = sensitiveMatch(title);
  if (sensitive) {
    return { decision: "skip", reason: `Sensitive topic ("${sensitive}"); the brand stays out of it.`, body: "", topics: [], mentions: [] };
  }
  const named = findMentions(title, [{ id: agent.id, aliases: agent.aliases }]).length > 0;
  if (!named) {
    return { decision: "skip", reason: `Headline does not name ${agent.name}.`, body: "", topics: [], mentions: [] };
  }
  const mentions = findMentions(title, input.agents, agent.id);
  let body = title;
  for (const id of mentions) {
    const other = input.agents.find((a) => a.id === id);
    if (!other) continue;
    const alias = [...other.aliases].sort((a, b) => b.length - a.length).find((x) => new RegExp(`\\b${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(body));
    if (alias) body = body.replace(new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), `@${other.id}`);
  }
  const lead = LEADS[input.seed % LEADS.length];
  const text = `${lead} ${body}`.replace(/\s+/g, " ").trim();
  return {
    decision: "post",
    reason: `Headline names ${agent.name}; posting the headline verbatim with attribution.`,
    body: text.length > 270 ? `${text.slice(0, 267).trimEnd()}...` : text,
    topics: extractTopics(title).slice(0, 4),
    mentions,
  };
}

const TOPIC_LABEL: Record<string, string> = {
  "food-delivery": "food delivery",
  "quick-commerce": "quick commerce",
  ev: "EV fleets",
  "gig-workers": "delivery partners",
  railways: "rail travel",
  "e-catering": "food on trains",
  payments: "digital payments",
  upi: "UPI",
  micromobility: "micromobility",
  logistics: "last-mile logistics",
};

export function rulesDecide(input: {
  agent: Agent;
  author: Agent;
  body: string;
  relation: string | null;
  score: number;
  mentioned: boolean;
  overlap: string[];
  allowWrite: boolean;
}): DecideOutput {
  const sensitive = sensitiveMatch(input.body);
  if (sensitive) return { action: "note", reason: "Relevant, but a sensitive subject; the brand does not engage publicly.", text: "" };
  if (input.relation === "competitor" && !input.mentioned) {
    return { action: "note", reason: "Competitor move in a shared market; worth knowing, not worth amplifying.", text: "" };
  }
  if (input.allowWrite && input.mentioned) {
    return {
      action: "reply",
      reason: "Named in the post, so a short acknowledgement is expected.",
      text: `Thanks for the mention, @${input.author.id}. Glad to be part of this.`,
    };
  }
  if (input.allowWrite && input.score >= 0.7 && input.overlap.length) {
    const label = TOPIC_LABEL[input.overlap[0]] ?? input.overlap[0];
    return {
      action: "quote",
      reason: `Directly relevant to our work on ${label}.`,
      text: `Relevant for everyone working on ${label}. We are following this closely.`,
    };
  }
  if (input.score >= 0.6 && input.relation !== "competitor") return { action: "like", reason: "Relevant, but nothing to add.", text: "" };
  if (input.score >= 0.6) return { action: "note", reason: "Relevant, but no public response is appropriate.", text: "" };
  return { action: "ignore", reason: "Low relevance to our business.", text: "" };
}
