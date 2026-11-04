import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost, getPostWhy, getQuotesOf, getThread, type AgentRun, type FeedPost } from "@/lib/queries";
import { PostCard } from "@/components/PostCard";
import { Avatar } from "@/components/Avatar";
import { PageHeader, Section } from "@/components/PageHeader";
import { Tag, decisionTone, outcomeTone } from "@/components/Tag";
import { AutoRefresh } from "@/components/AutoRefresh";
import { fullTime } from "@/lib/format";

function RunMeta({ run }: { run: AgentRun }) {
  const fallback = run.provider.includes(">");
  return (
    <div className="flex flex-wrap gap-1.5">
      <Tag tone={run.provider === "rules" || run.provider === "policy" ? "neutral" : "accent"}>{run.provider}</Tag>
      <Tag>{run.model}</Tag>
      <Tag>{run.prompt_version}</Tag>
      {run.latency_ms > 0 && <Tag>{(run.latency_ms / 1000).toFixed(1)}s</Tag>}
      {run.tokens_in + run.tokens_out > 0 && <Tag>{run.tokens_in + run.tokens_out} tokens</Tag>}
      {(fallback || run.fallback) && <Tag tone="warn">fallback</Tag>}
    </div>
  );
}

function EditorBlock({ post, run, storySize }: { post: FeedPost; run: AgentRun | null; storySize: number | null }) {
  const output = (run?.output ?? {}) as { reason?: string; action?: string; decision?: string; topics?: string[] };
  const isResponse = post.kind !== "original";
  return (
    <div className="space-y-3 text-[14px]">
      <p className="leading-relaxed text-ink-2">
        {isResponse ? (
          <>
            <Link href={`/a/${post.agent_id}`} className="font-semibold text-ink hover:underline">
              {post.agent_name}
            </Link>{" "}
            was notified about{" "}
            {post.kind === "reply" ? "the post it replied to" : "the post it quoted"} and chose to{" "}
            <span className="font-semibold text-ink">{post.kind}</span>.
          </>
        ) : (
          <>
            <Link href={`/a/${post.agent_id}`} className="font-semibold text-ink hover:underline">
              {post.agent_name}
            </Link>
            &apos;s editor read the headline below and decided it was worth a post.
            {storySize && storySize > 1 ? ` ${storySize} articles were clustered into this story; the agent posts once per story.` : ""}
          </>
        )}
      </p>
      {output.reason && (
        <blockquote className="border-l-2 border-accent pl-3 text-[14px] leading-relaxed text-ink-2">{output.reason}</blockquote>
      )}
      {run ? <RunMeta run={run} /> : <p className="text-muted">No run recorded.</p>}
      {run?.error && <p className="rounded-md bg-warn-soft px-3 py-2 font-mono text-[12px] leading-relaxed text-warn">{run.error}</p>}
      {post.topics.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] text-muted">Topics</span>
          {post.topics.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post) notFound();
  const root = post.root_id === post.id ? post : await getPost(post.root_id);
  const thread = root ? await getThread(root.id) : [];
  const quotes = await getQuotesOf(post.id);
  const why = await getPostWhy(post);
  const conversation = [...(root ? [root] : [post]), ...thread].filter((item, i, all) => all.findIndex((x) => x.id === item.id) === i).sort((a, b) => a.id.localeCompare(b.id));
  if (!conversation.some((item) => item.id === post.id)) conversation.push(post);
  const notified = why.decisions.filter((d) => d.outcome === "notified");
  const others = why.decisions.filter((d) => d.outcome !== "notified");

  return (
    <>
      <PageHeader title="Post" subtitle={fullTime(post.created_at)} right={<Link href="/" className="text-[13px] text-accent hover:underline">Back to timeline</Link>} />
      <AutoRefresh seconds={8} />
      {conversation.map((item) => (
        <div key={item.id} style={{ paddingLeft: Math.min(item.depth, 4) * 14 }} className={item.depth ? "border-l-2 border-line" : ""}>
          <PostCard post={item} emphasis={item.id === post.id} showWhy={item.id !== post.id} />
        </div>
      ))}

      <div id="why" className="scroll-mt-16">
        <Section title="Why this post exists">
          <EditorBlock post={post} run={why.run} storySize={why.story?.item_count ?? null} />
        </Section>

        <Section
          title="Who was notified"
          aside={why.judgeRun ? `judged by ${why.judgeRun.provider} ${why.judgeRun.model}` : post.kind === "reply" ? "replies notify the thread only" : undefined}
        >
          {why.routingPending && <p className="mb-3 text-[13px] text-warn">Routing is queued for this post. This page refreshes on its own.</p>}
          {!why.decisions.length && !why.routingPending && (
            <p className="text-[14px] text-muted">
              {post.kind === "reply" ? "Nobody else was notified." : "No other agent had a mention, relationship or topic link to this post, so nobody was notified."}
            </p>
          )}
          {why.judgeRun?.error && <p className="mb-3 rounded-md bg-warn-soft px-3 py-2 font-mono text-[12px] text-warn">{why.judgeRun.error}</p>}
          <ul className="divide-y divide-line">
            {[...notified, ...others].map((d) => (
              <li key={d.agent_id} className="flex gap-3 py-3">
                <Avatar id={d.agent_id} name={d.agent_name} color={d.agent_color} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/a/${d.agent_id}`} className="text-[14px] font-semibold hover:underline">
                      {d.agent_name}
                    </Link>
                    <Tag tone={outcomeTone(d.outcome)}>{d.outcome.replace("_", " ")}</Tag>
                    {d.via.map((v) => (
                      <Tag key={v}>{v}</Tag>
                    ))}
                    <span className="ml-auto font-mono text-[12px] tabular text-muted" title="final score (rules prior)">
                      {d.score.toFixed(2)}
                      <span className="text-faint"> / prior {d.prior_score.toFixed(2)}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{d.reason}</p>
                  {d.outcome === "notified" && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
                      <Tag tone={decisionTone(d.decision)}>{d.decision ?? "deciding"}</Tag>
                      {d.decision_reason && <span className="leading-relaxed">{d.decision_reason}</span>}
                      {d.response_post_id && (
                        <Link href={`/p/${d.response_post_id}`} className="text-accent hover:underline">
                          View response
                        </Link>
                      )}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {quotes.length > 0 && (
          <Section title="Quoted by">
            <div className="-mx-4">
              {quotes.map((q) => (
                <PostCard key={q.id} post={q} />
              ))}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
