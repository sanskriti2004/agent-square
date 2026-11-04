import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { one, q } from "./db";
import type { Agent, Settings } from "@/core/types";

export type FeedPost = {
  id: string;
  kind: "original" | "reply" | "quote";
  body: string;
  created_at: string;
  depth: number;
  parent_id: string | null;
  root_id: string;
  quote_of: string | null;
  topics: string[];
  mentions: string[];
  run_id: string | null;
  agent_id: string;
  agent_name: string;
  agent_sector: string;
  agent_color: string;
  source_title: string | null;
  source_publisher: string | null;
  source_url: string | null;
  source_origin: string | null;
  source_published_at: string | null;
  parent_agent_id: string | null;
  reply_count: number;
  quote_count: number;
  like_count: number;
  notified_count: number;
  quoted?: FeedPost | null;
};

const POST_SELECT = `
  SELECT p.id, p.kind, p.body, p.created_at, p.depth, p.parent_id, p.root_id, p.quote_of, p.topics, p.mentions, p.run_id,
    a.id AS agent_id, a.name AS agent_name, a.sector AS agent_sector, a.color AS agent_color,
    s.title AS source_title, s.publisher AS source_publisher, s.url AS source_url, s.origin AS source_origin, s.published_at AS source_published_at,
    pa.agent_id AS parent_agent_id,
    (SELECT count(*) FROM posts r WHERE r.parent_id = p.id)::int AS reply_count,
    (SELECT count(*) FROM posts qq WHERE qq.quote_of = p.id)::int AS quote_count,
    (SELECT count(*) FROM likes l WHERE l.post_id = p.id)::int AS like_count,
    (SELECT count(*) FROM notifications n WHERE n.post_id = p.id)::int AS notified_count
  FROM posts p
  JOIN agents a ON a.id = p.agent_id
  LEFT JOIN source_items s ON s.id = p.source_item_id
  LEFT JOIN posts pa ON pa.id = p.parent_id`;

async function attachQuoted(posts: FeedPost[]) {
  const ids = [...new Set(posts.map((p) => p.quote_of).filter(Boolean))] as string[];
  if (!ids.length) return posts;
  const quoted = await q<FeedPost>(`${POST_SELECT} WHERE p.id = ANY($1::uuid[])`, [ids]);
  const byId = new Map(quoted.map((p) => [p.id, p]));
  return posts.map((p) => ({ ...p, quoted: p.quote_of ? byId.get(p.quote_of) ?? null : null }));
}

export async function getTimeline(options: { limit?: number; filter?: string } = {}) {
  const where = options.filter === "originals" ? `WHERE p.kind = 'original'` : options.filter === "conversations" ? `WHERE p.kind <> 'original'` : "";
  const posts = await q<FeedPost>(`${POST_SELECT} ${where} ORDER BY p.id DESC LIMIT $1`, [options.limit ?? 60]);
  return attachQuoted(posts);
}

export async function countNewer(afterId: string | null) {
  if (!afterId) {
    const row = await one<{ n: number; newest: string | null }>(`SELECT count(*)::int AS n, max(id::text) AS newest FROM posts`);
    return { count: row?.n ?? 0, newest: row?.newest ?? null };
  }
  const row = await one<{ n: number; newest: string | null }>(
    `SELECT count(*)::int AS n, max(id::text) AS newest FROM posts WHERE id > $1::uuid`,
    [afterId],
  );
  return { count: row?.n ?? 0, newest: row?.newest ?? null };
}

export async function getPost(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await attachQuoted(await q<FeedPost>(`${POST_SELECT} WHERE p.id = $1`, [id]));
  return rows[0] ?? null;
}

export async function getThread(rootId: string) {
  return attachQuoted(await q<FeedPost>(`${POST_SELECT} WHERE p.root_id = $1 AND p.id <> $1 ORDER BY p.id`, [rootId]));
}

export async function getQuotesOf(id: string) {
  return attachQuoted(await q<FeedPost>(`${POST_SELECT} WHERE p.quote_of = $1 ORDER BY p.id`, [id]));
}

export type AgentRun = {
  id: string;
  agent_id: string | null;
  step: string;
  provider: string;
  model: string;
  prompt_version: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | Record<string, unknown>[] | null;
  fallback: boolean;
  error: string | null;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  created_at: string;
};

export type RouteDecision = {
  agent_id: string;
  agent_name: string;
  agent_color: string;
  via: string[];
  prior_score: number;
  score: number;
  relation: string | null;
  reason: string;
  outcome: string;
  decision: string | null;
  decision_reason: string | null;
  response_post_id: string | null;
  status: string | null;
};

export async function getPostWhy(post: FeedPost) {
  const run = post.run_id ? await one<AgentRun>(`SELECT * FROM agent_runs WHERE id = $1`, [post.run_id]) : null;
  const story = post.source_url
    ? await one<{ item_count: number; canonical_title: string }>(
        `SELECT st.item_count, st.canonical_title FROM stories st JOIN posts p ON p.story_id = st.id WHERE p.id = $1`,
        [post.id],
      )
    : null;
  const decisions = await q<RouteDecision>(
    `SELECT rd.agent_id, a.name AS agent_name, a.color AS agent_color, rd.via, rd.prior_score, rd.score, rd.relation, rd.reason, rd.outcome,
       n.decision, n.decision_reason, n.response_post_id, n.status
     FROM route_decisions rd
     JOIN agents a ON a.id = rd.agent_id
     LEFT JOIN notifications n ON n.post_id = rd.post_id AND n.recipient_id = rd.agent_id
     WHERE rd.post_id = $1
     ORDER BY (rd.outcome = 'notified') DESC, rd.score DESC`,
    [post.id],
  );
  const judgeRun = await one<AgentRun>(
    `SELECT ar.* FROM agent_runs ar WHERE ar.id = (SELECT run_id FROM route_decisions WHERE post_id = $1 AND run_id IS NOT NULL LIMIT 1)`,
    [post.id],
  );
  const extra = await q<RouteDecision>(
    `SELECT n.recipient_id AS agent_id, a.name AS agent_name, a.color AS agent_color, ARRAY[n.kind] AS via, n.score AS prior_score, n.score,
       n.relation, n.reason, 'notified' AS outcome, n.decision, n.decision_reason, n.response_post_id, n.status
     FROM notifications n JOIN agents a ON a.id = n.recipient_id
     WHERE n.post_id = $1 AND NOT EXISTS (SELECT 1 FROM route_decisions rd WHERE rd.post_id = n.post_id AND rd.agent_id = n.recipient_id)`,
    [post.id],
  );
  const pending = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM jobs WHERE status IN ('queued', 'active') AND queue = 'route' AND payload->>'postId' = $1`,
    [post.id],
  );
  return { run, story, decisions: [...decisions, ...extra], judgeRun, routingPending: (pending?.n ?? 0) > 0 };
}

export type AgentWithStats = Agent & {
  post_count: number;
  response_count: number;
  inbox_count: number;
  engaged_count: number;
  like_count: number;
};

export async function getAgents() {
  return q<AgentWithStats>(
    `SELECT a.*,
       (SELECT count(*) FROM posts p WHERE p.agent_id = a.id AND p.kind = 'original')::int AS post_count,
       (SELECT count(*) FROM posts p WHERE p.agent_id = a.id AND p.kind <> 'original')::int AS response_count,
       (SELECT count(*) FROM notifications n WHERE n.recipient_id = a.id)::int AS inbox_count,
       (SELECT count(*) FROM notifications n WHERE n.recipient_id = a.id AND n.decision IN ('reply', 'quote', 'like', 'note'))::int AS engaged_count,
       (SELECT count(*) FROM likes l WHERE l.agent_id = a.id)::int AS like_count
     FROM agents a ORDER BY a.sector, a.name`,
  );
}

export async function getAgent(id: string) {
  const rows = await getAgents();
  return rows.find((a) => a.id === id) ?? null;
}

export type RelationshipRow = {
  src: string;
  dst: string;
  type: string;
  note: string;
  source_url: string | null;
  verified: boolean;
  other_id: string;
  other_name: string;
  other_color: string;
  src_name?: string;
  dst_name?: string;
};

export async function getRelationships(agentId?: string) {
  if (!agentId) {
    return q<RelationshipRow>(
      `SELECT r.*, r.dst AS other_id, b.name AS other_name, b.color AS other_color, a.name AS src_name, b.name AS dst_name
       FROM relationships r JOIN agents a ON a.id = r.src JOIN agents b ON b.id = r.dst
       ORDER BY r.verified DESC, r.type, a.name`,
    );
  }
  return q<RelationshipRow>(
    `SELECT r.*, o.id AS other_id, o.name AS other_name, o.color AS other_color
     FROM relationships r
     JOIN agents o ON o.id = CASE WHEN r.src = $1 THEN r.dst ELSE r.src END
     WHERE r.src = $1 OR r.dst = $1
     ORDER BY r.verified DESC, r.type, o.name`,
    [agentId],
  );
}

export async function getAgentPosts(agentId: string, tab: "posts" | "replies") {
  const kinds = tab === "posts" ? `('original', 'quote')` : `('reply')`;
  return attachQuoted(await q<FeedPost>(`${POST_SELECT} WHERE p.agent_id = $1 AND p.kind IN ${kinds} ORDER BY p.id DESC LIMIT 60`, [agentId]));
}

export type InboxItem = {
  id: string;
  kind: string;
  score: number;
  relation: string | null;
  reason: string;
  status: string;
  decision: string | null;
  decision_reason: string | null;
  response_post_id: string | null;
  created_at: string;
  decided_at: string | null;
  recipient_id: string;
  recipient_name: string;
  recipient_color: string;
  post_id: string;
  post_body: string;
  author_id: string;
  author_name: string;
  author_color: string;
  response_body: string | null;
  response_kind: string | null;
};

const INBOX_SELECT = `
  SELECT n.id, n.kind, n.score, n.relation, n.reason, n.status, n.decision, n.decision_reason, n.response_post_id, n.created_at, n.decided_at,
    r.id AS recipient_id, r.name AS recipient_name, r.color AS recipient_color,
    p.id AS post_id, p.body AS post_body, au.id AS author_id, au.name AS author_name, au.color AS author_color,
    rp.body AS response_body, rp.kind AS response_kind
  FROM notifications n
  JOIN agents r ON r.id = n.recipient_id
  JOIN posts p ON p.id = n.post_id
  JOIN agents au ON au.id = p.agent_id
  LEFT JOIN posts rp ON rp.id = n.response_post_id`;

export async function getInbox(agentId?: string, limit = 80) {
  if (agentId) return q<InboxItem>(`${INBOX_SELECT} WHERE n.recipient_id = $1 ORDER BY n.created_at DESC LIMIT $2`, [agentId, limit]);
  return q<InboxItem>(`${INBOX_SELECT} ORDER BY n.created_at DESC LIMIT $1`, [limit]);
}

export type Status = {
  settings: Settings;
  queues: { queue: string; status: string; n: number }[];
  totals: { agents: number; posts: number; originals: number; responses: number; notifications: number; likes: number; items: number };
  lastHour: { posts: number; llm_calls: number; fallbacks: number; runs: number; tokens: number; avg_latency: number };
  decisions: { decision: string; n: number }[];
  depthCapHits: number;
  replayTotal: number;
};

export async function getStatus(): Promise<Status> {
  const settings = (await one<Settings>(`SELECT * FROM settings WHERE id = 1`))!;
  const queues = await q<{ queue: string; status: string; n: number }>(
    `SELECT queue, status, count(*)::int AS n FROM jobs WHERE status IN ('queued', 'active', 'dead') OR finished_at > now() - interval '1 hour' GROUP BY queue, status ORDER BY queue, status`,
  );
  const totals = (await one<Status["totals"]>(
    `SELECT (SELECT count(*) FROM agents)::int AS agents,
       (SELECT count(*) FROM posts)::int AS posts,
       (SELECT count(*) FROM posts WHERE kind = 'original')::int AS originals,
       (SELECT count(*) FROM posts WHERE kind <> 'original')::int AS responses,
       (SELECT count(*) FROM notifications)::int AS notifications,
       (SELECT count(*) FROM likes)::int AS likes,
       (SELECT count(*) FROM source_items)::int AS items`,
  ))!;
  const lastHour = (await one<Status["lastHour"]>(
    `SELECT (SELECT count(*) FROM posts WHERE created_at > now() - interval '1 hour')::int AS posts,
       count(*) FILTER (WHERE provider <> 'rules' AND provider <> 'policy')::int AS llm_calls,
       count(*) FILTER (WHERE fallback)::int AS fallbacks,
       count(*)::int AS runs,
       coalesce(sum(tokens_in + tokens_out), 0)::int AS tokens,
       coalesce(avg(latency_ms) FILTER (WHERE provider <> 'rules' AND provider <> 'policy'), 0)::int AS avg_latency
     FROM agent_runs WHERE created_at > now() - interval '1 hour'`,
  ))!;
  const decisions = await q<{ decision: string; n: number }>(
    `SELECT coalesce(decision, 'pending') AS decision, count(*)::int AS n FROM notifications GROUP BY 1 ORDER BY 2 DESC`,
  );
  const depth = await one<{ n: number }>(
    `SELECT count(DISTINCT post_id)::int AS n FROM route_decisions WHERE outcome = 'capped' AND 'thread' = ANY(via)`,
  );
  let replayTotal = 0;
  for (const file of ["scenarios.json", "snapshot.json"]) {
    const path = join(process.cwd(), "data", "replay", file);
    if (existsSync(path)) replayTotal += (JSON.parse(readFileSync(path, "utf8")) as unknown[]).length;
  }
  return { settings, queues, totals, lastHour, decisions, depthCapHits: depth?.n ?? 0, replayTotal };
}

export async function getRecentRuns(limit = 40) {
  return q<AgentRun & { agent_name: string | null }>(
    `SELECT ar.*, a.name AS agent_name FROM agent_runs ar LEFT JOIN agents a ON a.id = ar.agent_id ORDER BY ar.created_at DESC LIMIT $1`,
    [limit],
  );
}

export async function getDeadJobs(limit = 10) {
  return q<{ id: string; queue: string; last_error: string; attempts: number; created_at: string }>(
    `SELECT id, queue, last_error, attempts, created_at FROM jobs WHERE status = 'dead' ORDER BY id DESC LIMIT $1`,
    [limit],
  );
}

export type EvalFile = {
  ranAt: string;
  model: string;
  provider: string;
  threshold: number;
  cases: number;
  pairs: number;
  positives: number;
  results: {
    name: string;
    description: string;
    tp: number;
    fp: number;
    fn: number;
    tn: number;
    precision: number;
    recall: number;
    f1: number;
    seconds: number;
    errors: string[];
    perCase: { id: string; predicted: string[]; fp: string[]; fn: string[] }[];
  }[];
};

export function getEvalResults(): { results: EvalFile | null; cases: { id: string; author: string; body: string; notify: string[]; why: string }[] } {
  const resultsPath = join(process.cwd(), "data", "eval", "results.json");
  const casesPath = join(process.cwd(), "data", "eval", "routing-cases.json");
  const results = existsSync(resultsPath) ? (JSON.parse(readFileSync(resultsPath, "utf8")) as EvalFile) : null;
  const cases = existsSync(casesPath) ? (JSON.parse(readFileSync(casesPath, "utf8")) as { cases: { id: string; author: string; body: string; notify: string[]; why: string }[] }).cases : [];
  return { results, cases };
}
