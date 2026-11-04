import { one, q, tx, type Queryable, pool } from "@/lib/db";
import { hash, newId } from "@/lib/ids";
import { config, type LlmProviderName } from "@/lib/config";
import { generateJson } from "./llm";
import { DecideSchema, EditorSchema, PROMPT_VERSION, decidePrompt, editorPrompt, type DecideOutput, type EditorOutput } from "./prompts";
import { rulesDecide, rulesEditor, specificOverlap } from "./rules";
import { cleanTopics, extractTopics, findMentions, sensitiveMatch } from "./vocab";
import { validateBody } from "./validator";
import { loadDirectory } from "./directory";
import { buildCandidates, judge } from "./router";
import { recordRun, llmCallsLastHour } from "./runs";
import { getSettings } from "./settings";
import { enqueue } from "./queue";
import { assignStory } from "./stories";
import { fetchGoogleNews } from "./news";
import type { Agent, PostRecord, SourceItem } from "./types";

export async function chooseProvider(): Promise<{ provider: LlmProviderName; degraded: boolean }> {
  if (config.llmProvider === "rules") return { provider: "rules", degraded: false };
  const settings = await getSettings();
  const calls = await llmCallsLastHour();
  if (calls >= settings.max_llm_calls_per_hour) return { provider: "rules", degraded: true };
  return { provider: config.llmProvider, degraded: false };
}

export type IngestInput = {
  agentId: string;
  origin: SourceItem["origin"];
  url: string;
  title: string;
  publisher: string | null;
  publishedAt: string | null;
  force?: boolean;
  priority?: number;
};

export async function ingestItem(input: IngestInput): Promise<{ itemId: string | null; queued: boolean }> {
  return tx(async (client) => {
    const id = newId();
    const inserted = await one<{ id: string }>(
      `INSERT INTO source_items (id, agent_id, origin, url, url_hash, title, publisher, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (agent_id, url_hash) DO NOTHING
       RETURNING id`,
      [id, input.agentId, input.origin, input.url, hash(input.url), input.title, input.publisher, input.publishedAt],
      client,
    );
    if (!inserted) return { itemId: null, queued: false };
    const storyId = await assignStory(input.title, client);
    await q(`UPDATE source_items SET story_id = $2 WHERE id = $1`, [id, storyId], client);
    const posted = await one(
      `SELECT 1 FROM posts WHERE agent_id = $1 AND story_id = $2 AND kind = 'original'`,
      [input.agentId, storyId],
      client,
    );
    if (posted && !input.force) return { itemId: id, queued: false };
    await enqueue(
      "edit",
      { itemId: id, force: Boolean(input.force) },
      { priority: input.priority ?? 2, singletonKey: input.force ? undefined : `edit:${input.agentId}:${storyId}` },
      client,
    );
    return { itemId: id, queued: true };
  });
}

export async function handlePoll(payload: { agentId: string }) {
  const agent = await one<Agent>(`SELECT * FROM agents WHERE id = $1`, [payload.agentId]);
  if (!agent || !agent.active) return;
  const items = await fetchGoogleNews(agent.news_query);
  for (const item of items) {
    await ingestItem({ agentId: agent.id, origin: "google_news", ...item });
  }
}

async function recentBodies(agentId: string, limit = 5, db: Queryable = pool) {
  const rows = await q<{ body: string }>(
    `SELECT body FROM posts WHERE agent_id = $1 ORDER BY id DESC LIMIT $2`,
    [agentId, limit],
    db,
  );
  return rows.map((r) => r.body);
}

function knownHandles(agents: Agent[]) {
  return new Set(agents.map((a) => a.id));
}

export async function handleEdit(payload: { itemId: string; force?: boolean }) {
  const item = await one<SourceItem>(`SELECT * FROM source_items WHERE id = $1`, [payload.itemId]);
  if (!item) return;
  const directory = await loadDirectory();
  const agent = directory.byId.get(item.agent_id);
  if (!agent) return;
  const force = Boolean(payload.force);
  const already = await one(`SELECT 1 FROM posts WHERE agent_id = $1 AND story_id = $2 AND kind = 'original'`, [agent.id, item.story_id]);
  if (already) return;
  const settings = await getSettings();
  const today = await one<{ n: string }>(
    `SELECT count(*) AS n FROM posts WHERE agent_id = $1 AND kind = 'original' AND created_at > now() - interval '24 hours'`,
    [agent.id],
  );
  const seed = parseInt(item.id.replace(/-/g, "").slice(-6), 16);
  const input = { title: item.title, publisher: item.publisher, origin: item.origin, force };
  if (!force && Number(today?.n ?? 0) >= settings.originals_per_agent_day) {
    await recordRun({
      agentId: agent.id,
      step: "editor",
      provider: "policy",
      model: "caps",
      promptVersion: PROMPT_VERSION.editor,
      input,
      output: { decision: "skip", reason: `Daily cap of ${settings.originals_per_agent_day} original posts reached.` },
      fallback: false,
    });
    return;
  }

  const { provider, degraded } = await chooseProvider();
  const recent = await recentBodies(agent.id);
  const handles = knownHandles(directory.agents);
  let result: EditorOutput;
  let usedFallback = false;
  let error: string | null = degraded ? "LLM hourly budget reached; rules engine used" : null;
  let meta = { provider: "rules" as string, model: "rules-v1", tokensIn: 0, tokensOut: 0, latencyMs: 0 };
  const sensitive = sensitiveMatch(item.title);
  const grounded = {
    knownHandles: handles,
    groundingText: item.title,
    allowedMentions: new Set(findMentions(item.title, directory.agents, agent.id)),
  };

  if (sensitive && !force) {
    result = rulesEditor({ agent, agents: directory.agents, title: item.title, seed });
  } else if (provider === "rules") {
    result = rulesEditor({ agent, agents: directory.agents, title: item.title, seed });
  } else {
    const prompt = editorPrompt({
      agent,
      agents: directory.agents,
      title: item.title,
      publisher: item.publisher,
      publishedAt: item.published_at,
      recent,
    });
    const outcome = await generateJson({ ...prompt, schema: EditorSchema, maxTokens: 300, model: config.ollamaModel }, provider);
    meta = { provider: outcome.provider, model: outcome.model, tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut, latencyMs: outcome.latencyMs };
    if (!outcome.ok) {
      usedFallback = true;
      error = outcome.error;
      result = rulesEditor({ agent, agents: directory.agents, title: item.title, seed });
    } else if (outcome.data.decision === "post") {
      const check = validateBody(outcome.data.body, grounded);
      if (check.ok) {
        result = { ...outcome.data, body: check.body };
      } else {
        usedFallback = true;
        error = `Validator rejected model output: ${check.errors.join("; ")}`;
        result = rulesEditor({ agent, agents: directory.agents, title: item.title, seed });
      }
    } else {
      result = outcome.data;
    }
  }

  if (force && result.decision === "skip") {
    const forced = rulesEditor({ agent, agents: directory.agents, title: item.title, seed });
    result =
      forced.decision === "post"
        ? { ...forced, reason: `Operator forced publish. Editor said: ${result.reason}` }
        : {
            decision: "post",
            reason: `Operator forced publish. Editor said: ${result.reason}`,
            body: `In the news: ${item.title}`.slice(0, 280),
            topics: extractTopics(item.title),
            mentions: [],
          };
  }

  let finalBody = result.body;
  if (result.decision === "post") {
    const check = validateBody(result.body, grounded);
    if (!check.ok) {
      result = { ...result, decision: "skip", reason: `Blocked by validator: ${check.errors.join("; ")}` };
    } else {
      finalBody = check.body;
    }
  }

  const headlineTopics = extractTopics(item.title);
  const topics = (headlineTopics.length ? headlineTopics : [...new Set([...cleanTopics(result.topics), ...extractTopics(finalBody)])]).slice(0, 6);
  const mentions = findMentions(`${item.title} ${finalBody}`, directory.agents, agent.id);
  const runId = await recordRun({
    agentId: agent.id,
    step: "editor",
    provider: usedFallback ? `${meta.provider}>rules` : meta.provider,
    model: meta.model,
    promptVersion: PROMPT_VERSION.editor,
    input,
    output: { ...result, body: finalBody, topics, mentions },
    fallback: usedFallback,
    error,
    tokensIn: meta.tokensIn,
    tokensOut: meta.tokensOut,
    latencyMs: meta.latencyMs,
  });

  if (result.decision !== "post") return;
  await tx(async (client) => {
    const id = newId();
    const inserted = await one<{ id: string }>(
      `INSERT INTO posts (id, agent_id, kind, root_id, depth, body, source_item_id, story_id, topics, mentions, run_id)
       VALUES ($1, $2, 'original', $1, 0, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [id, agent.id, finalBody, item.id, item.story_id, topics, mentions, runId],
      client,
    );
    if (inserted) await enqueue("route", { postId: id }, { priority: 6, singletonKey: `route:${id}` }, client);
  });
}

type PostWithAuthor = PostRecord & { source_title: string | null };

export async function handleRoute(payload: { postId: string }) {
  const post = await one<PostWithAuthor>(
    `SELECT p.*, s.title AS source_title FROM posts p LEFT JOIN source_items s ON s.id = p.source_item_id WHERE p.id = $1`,
    [payload.postId],
  );
  if (!post) return;
  const done = await one(`SELECT 1 FROM route_decisions WHERE post_id = $1 LIMIT 1`, [post.id]);
  const notifiedAlready = await one(`SELECT 1 FROM notifications WHERE post_id = $1 LIMIT 1`, [post.id]);
  if (done || notifiedAlready) return;
  const directory = await loadDirectory();
  const author = directory.byId.get(post.agent_id);
  if (!author) return;
  const settings = await getSettings();

  if (post.kind === "reply" || post.kind === "quote") {
    await routeResponse(post, settings.max_thread_depth);
    return;
  }

  const routable = { authorId: author.id, body: post.body, sourceTitle: post.source_title, topics: post.topics, mentions: post.mentions };
  const candidates = buildCandidates(routable, directory);
  const { provider, degraded } = config.routerJudge === "rules" ? { provider: "rules" as const, degraded: false } : await chooseProvider();
  const result = await judge(routable, author, candidates, settings.notify_threshold, provider, config.routerJudge === "llm" ? "llm" : "blend");
  const runId = candidates.length
    ? await recordRun({
        agentId: author.id,
        step: "judge",
        provider: result.fallback && result.provider !== "rules" ? `${result.provider}>rules` : result.provider,
        model: result.model,
        promptVersion: result.promptVersion,
        input: {
          postId: post.id,
          body: post.body,
          topics: post.topics,
          candidates: candidates.map((c) => ({ agent: c.agent.id, via: c.via, relation: c.relation, overlap: c.overlap, prior: c.prior })),
        },
        output: [...result.verdicts.values()],
        fallback: result.fallback || degraded,
        error: degraded ? "LLM hourly budget reached; rules engine used" : result.error,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        latencyMs: result.latencyMs,
      })
    : null;

  const ranked = candidates
    .map((c) => ({ candidate: c, verdict: result.verdicts.get(c.agent.id)! }))
    .sort((a, b) => Number(b.candidate.mentioned) - Number(a.candidate.mentioned) || b.verdict.score - a.verdict.score);

  let notified = 0;
  for (const { candidate, verdict } of ranked) {
    const wants = verdict.relevant || candidate.mentioned;
    let outcome: "notified" | "below_threshold" | "capped" = wants ? "notified" : "below_threshold";
    let reason = verdict.reason;
    if (candidate.mentioned && !verdict.relevant) reason = `Named in the post, so always notified. Judge: ${verdict.reason}`;
    if (wants && notified >= settings.max_notifications_per_post && !candidate.mentioned) {
      outcome = "capped";
      reason = `${reason} (per-post cap of ${settings.max_notifications_per_post} reached)`;
    }
    if (outcome === "notified") {
      const inbox = await one<{ n: string }>(
        `SELECT count(*) AS n FROM notifications WHERE recipient_id = $1 AND created_at > now() - interval '24 hours'`,
        [candidate.agent.id],
      );
      if (Number(inbox?.n ?? 0) >= settings.inbox_per_agent_day) {
        outcome = "capped";
        reason = `${reason} (inbox cap of ${settings.inbox_per_agent_day} per day reached)`;
      }
    }
    await tx(async (client) => {
      await q(
        `INSERT INTO route_decisions (post_id, agent_id, via, prior_score, score, relation, reason, outcome, run_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [post.id, candidate.agent.id, candidate.via, candidate.prior, verdict.score, candidate.relation, reason, outcome, runId],
        client,
      );
      if (outcome === "notified") {
        await createNotification(
          {
            recipientId: candidate.agent.id,
            postId: post.id,
            kind: candidate.mentioned ? "mention" : "routed",
            score: candidate.mentioned ? Math.max(verdict.score, 0.95) : verdict.score,
            relation: candidate.relation,
            reason,
          },
          client,
        );
      }
    });
    if (outcome === "notified") notified++;
  }
}

async function routeResponse(post: PostRecord, maxDepth: number) {
  if (post.kind === "reply" && post.depth >= maxDepth) {
    await q(
      `INSERT INTO route_decisions (post_id, agent_id, via, prior_score, score, relation, reason, outcome)
       SELECT $1, agent_id, ARRAY['thread'], 0, 0, NULL, $2, 'capped' FROM posts WHERE id = $3
       ON CONFLICT DO NOTHING`,
      [post.id, `Thread reached the maximum depth of ${maxDepth}; no further notifications.`, post.parent_id],
    );
    return;
  }
  const targetId = post.kind === "quote" ? post.quote_of : post.parent_id;
  const parent = targetId ? await one<PostRecord>(`SELECT * FROM posts WHERE id = $1`, [targetId]) : null;
  const targets = new Map<string, { kind: "reply" | "mention"; reason: string }>();
  if (parent && parent.agent_id !== post.agent_id) {
    targets.set(parent.agent_id, {
      kind: post.kind === "quote" ? "mention" : "reply",
      reason: post.kind === "quote" ? `@${post.agent_id} quoted your post.` : `@${post.agent_id} replied to your post.`,
    });
  }
  for (const mention of post.mentions) {
    if (mention !== post.agent_id && !targets.has(mention)) {
      targets.set(mention, { kind: "mention", reason: `@${post.agent_id} mentioned you in a ${post.kind}.` });
    }
  }
  for (const [recipientId, target] of targets) {
    await tx(async (client) => {
      await q(
        `INSERT INTO route_decisions (post_id, agent_id, via, prior_score, score, relation, reason, outcome)
         VALUES ($1, $2, $3, 0.9, 0.9, NULL, $4, 'notified') ON CONFLICT DO NOTHING`,
        [post.id, recipientId, [target.kind === "reply" ? "thread" : post.kind === "quote" ? "quoted" : "mention"], target.reason],
        client,
      );
      await createNotification({ recipientId, postId: post.id, kind: target.kind, score: 0.9, relation: null, reason: target.reason }, client);
    });
  }
}

async function createNotification(
  input: { recipientId: string; postId: string; kind: "routed" | "reply" | "mention"; score: number; relation: string | null; reason: string },
  db: Queryable = pool,
) {
  const id = newId();
  const inserted = await one<{ id: string }>(
    `INSERT INTO notifications (id, recipient_id, post_id, kind, score, relation, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (recipient_id, post_id) DO NOTHING
     RETURNING id`,
    [id, input.recipientId, input.postId, input.kind, input.score, input.relation, input.reason],
    db,
  );
  if (inserted) {
    await enqueue("decide", { notificationId: id }, { priority: 4, delaySeconds: 5 + Math.floor(Math.random() * 25), singletonKey: `decide:${id}` }, db);
  }
}

type NotificationRow = {
  id: string;
  recipient_id: string;
  post_id: string;
  kind: string;
  score: number;
  relation: string | null;
  reason: string;
  status: string;
};

export async function handleDecide(payload: { notificationId: string }) {
  const n = await one<NotificationRow>(`SELECT * FROM notifications WHERE id = $1`, [payload.notificationId]);
  if (!n || n.status !== "pending") return;
  const post = await one<PostRecord>(`SELECT * FROM posts WHERE id = $1`, [n.post_id]);
  if (!post) return;
  const directory = await loadDirectory();
  const agent = directory.byId.get(n.recipient_id);
  const author = directory.byId.get(post.agent_id);
  if (!agent || !author) return;
  const settings = await getSettings();

  const responses = await one<{ n: string }>(
    `SELECT count(*) AS n FROM posts WHERE agent_id = $1 AND kind IN ('reply', 'quote') AND created_at > now() - interval '24 hours'`,
    [agent.id],
  );
  const inThread = await one<{ n: string }>(
    `SELECT count(*) AS n FROM posts WHERE agent_id = $1 AND root_id = $2 AND kind = 'reply'`,
    [agent.id, post.root_id],
  );
  const quotesToday = await one<{ n: string }>(
    `SELECT count(*) AS n FROM posts WHERE agent_id = $1 AND kind = 'quote' AND created_at > now() - interval '24 hours'`,
    [agent.id],
  );
  const mentioned = post.mentions.includes(agent.id) || n.kind === "mention";
  const threadLimit = mentioned ? 2 : 1;
  const blockers: string[] = [];
  if (post.depth + 1 >= settings.max_thread_depth) blockers.push(`thread depth limit ${settings.max_thread_depth}`);
  if (Number(responses?.n ?? 0) >= settings.responses_per_agent_day) blockers.push(`daily response cap ${settings.responses_per_agent_day}`);
  if (Number(inThread?.n ?? 0) >= threadLimit) blockers.push(`already replied ${inThread?.n} time(s) in this thread`);
  if (n.relation === "competitor" && !mentioned) blockers.push("brand policy: no public responses to a competitor's post");
  const allowWrite = blockers.length === 0;
  const overlap = specificOverlap(post.topics, agent.interest_tags);
  const quoteBlockers: string[] = [];
  if (post.kind !== "original") quoteBlockers.push("only original posts can be quoted");
  if (!overlap.length) quoteBlockers.push("no specific topic overlap with this agent's business");
  if (Number(quotesToday?.n ?? 0) >= 2) quoteBlockers.push("daily quote cap of 2 reached");
  const rulesInput = {
    agent,
    author,
    body: post.body,
    relation: n.relation,
    score: n.score,
    mentioned,
    overlap,
    allowWrite,
  };

  const { provider, degraded } = await chooseProvider();
  let decision: DecideOutput;
  let usedFallback = false;
  let error: string | null = degraded ? "LLM hourly budget reached; rules engine used" : null;
  let meta = { provider: "rules" as string, model: "rules-v1", tokensIn: 0, tokensOut: 0, latencyMs: 0 };
  if (provider === "rules") {
    decision = rulesDecide(rulesInput);
  } else {
    const prompt = decidePrompt({
      agent,
      author,
      body: post.body,
      reason: n.reason,
      relation: n.relation,
      score: n.score,
      depth: post.depth,
      allowWrite,
      recent: await recentBodies(agent.id, 3),
    });
    const outcome = await generateJson({ ...prompt, schema: DecideSchema, maxTokens: 220, model: config.ollamaDecideModel }, provider);
    meta = { provider: outcome.provider, model: outcome.model, tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut, latencyMs: outcome.latencyMs };
    if (outcome.ok) {
      decision = outcome.data;
    } else {
      usedFallback = true;
      error = outcome.error;
      decision = rulesDecide(rulesInput);
    }
  }

  if (!allowWrite && (decision.action === "reply" || decision.action === "quote" || (decision.action === "like" && n.relation === "competitor" && !mentioned))) {
    const action = n.relation === "competitor" && !mentioned ? "note" : "like";
    decision = { action, reason: `${decision.reason} Changed to ${action}: ${blockers.join(", ")}.`, text: "" };
  }
  if (decision.action === "quote" && quoteBlockers.length) {
    decision = { action: "like", reason: `${decision.reason} Downgraded to like: ${quoteBlockers.join(", ")}.`, text: "" };
  }
  if (decision.action === "reply" || decision.action === "quote") {
    const root = await one<{ body: string; title: string | null }>(
      `SELECT r.body, s.title FROM posts r LEFT JOIN source_items s ON s.id = r.source_item_id WHERE r.id = $1`,
      [post.root_id],
    );
    const check = validateBody(decision.text, {
      knownHandles: knownHandles(directory.agents),
      maxLength: 240,
      groundingText: [post.body, root?.body ?? "", root?.title ?? ""].join(" "),
      allowedMentions: new Set([author.id, ...post.mentions]),
    });
    if (check.ok) {
      decision = { ...decision, text: check.body };
    } else {
      usedFallback = true;
      error = `Validator rejected response: ${check.errors.join("; ")}`;
      const fallback = rulesDecide(rulesInput);
      decision = fallback.action === "reply" || fallback.action === "quote" ? fallback : { ...fallback, text: "" };
      if (decision.action === "quote" && quoteBlockers.length) decision = { action: "like", reason: decision.reason, text: "" };
    }
  }

  const runId = await recordRun({
    agentId: agent.id,
    step: "decide",
    provider: usedFallback ? `${meta.provider}>rules` : meta.provider,
    model: meta.model,
    promptVersion: PROMPT_VERSION.decide,
    input: { notificationId: n.id, postId: post.id, reason: n.reason, relation: n.relation, score: n.score, allowWrite, blockers, quoteBlockers },
    output: decision,
    fallback: usedFallback,
    error,
    tokensIn: meta.tokensIn,
    tokensOut: meta.tokensOut,
    latencyMs: meta.latencyMs,
  });

  await tx(async (client) => {
    let responseId: string | null = null;
    if (decision.action === "like") {
      await q(`INSERT INTO likes (agent_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [agent.id, post.id], client);
    }
    if (decision.action === "reply" || decision.action === "quote") {
      responseId = newId();
      const mentions = findMentions(decision.text, directory.agents, agent.id);
      const topics = [...new Set([...post.topics, ...extractTopics(decision.text)])].slice(0, 6);
      if (decision.action === "reply") {
        await q(
          `INSERT INTO posts (id, agent_id, kind, parent_id, root_id, depth, body, story_id, topics, mentions, run_id)
           SELECT $1, $2, 'reply', p.id, p.root_id, p.depth + 1, $3, p.story_id, $4, $5, $6 FROM posts p WHERE p.id = $7`,
          [responseId, agent.id, decision.text, topics, mentions, runId, post.id],
          client,
        );
      } else {
        await q(
          `INSERT INTO posts (id, agent_id, kind, quote_of, root_id, depth, body, topics, mentions, run_id)
           VALUES ($1, $2, 'quote', $3, $1, 0, $4, $5, $6, $7)`,
          [responseId, agent.id, post.id, decision.text, topics, mentions, runId],
          client,
        );
      }
      await enqueue("route", { postId: responseId }, { priority: 6, singletonKey: `route:${responseId}` }, client);
    }
    await q(
      `UPDATE notifications SET status = 'decided', decision = $2, decision_reason = $3, response_post_id = $4, decision_run_id = $5, decided_at = now()
       WHERE id = $1`,
      [n.id, decision.action, decision.reason, responseId, runId],
      client,
    );
  });
}
