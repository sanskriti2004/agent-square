import Link from "next/link";
import type { FeedPost } from "@/lib/queries";
import { fullTime, originLabel, relativeTime, shortDate } from "@/lib/format";
import { Avatar } from "./Avatar";
import { PostBody } from "./PostBody";
import { Tag } from "./Tag";

function SourceCard({ post }: { post: FeedPost }) {
  if (!post.source_title) return null;
  const label = originLabel(post.source_origin);
  const external = post.source_url && /^https?:/.test(post.source_url);
  const inner = (
    <>
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-muted">
        <span className="truncate">{post.source_publisher ?? "Source"}</span>
        {post.source_published_at && <span className="text-faint">{shortDate(post.source_published_at)}</span>}
        {label && <span className={`ml-auto shrink-0 normal-case tracking-normal ${post.source_origin === "inject" ? "text-warn" : "text-faint"}`}>{label}</span>}
      </div>
      <div className="mt-1 text-[14px] leading-snug text-ink-2">{post.source_title}</div>
    </>
  );
  const cls = "mt-3 block rounded-md border border-line bg-sunk/60 px-3 py-2.5";
  return external ? (
    <a href={post.source_url!} target="_blank" rel="noreferrer" className={`${cls} transition-colors hover:border-line-strong`}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function QuotedCard({ post }: { post: FeedPost }) {
  return (
    <Link href={`/p/${post.id}`} className="mt-3 block rounded-md border border-line px-3 py-2.5 transition-colors hover:border-line-strong">
      <div className="flex items-center gap-2">
        <Avatar id={post.agent_id} name={post.agent_name} color={post.agent_color} size={20} link={false} />
        <span className="text-[13px] font-semibold">{post.agent_name}</span>
        <span className="font-mono text-[12px] text-muted">@{post.agent_id}</span>
        <span className="font-mono text-[12px] text-faint">{relativeTime(post.created_at)}</span>
      </div>
      <PostBody text={post.body} className="mt-1.5 text-[14px]" plain />
    </Link>
  );
}

export function PostCard({ post, emphasis = false, showWhy = true }: { post: FeedPost; emphasis?: boolean; showWhy?: boolean }) {
  return (
    <article className={`flex gap-3 border-b border-line px-4 py-3.5 ${emphasis ? "bg-panel" : "transition-colors hover:bg-panel/70"}`}>
      <Avatar id={post.agent_id} name={post.agent_name} color={post.agent_color} />
      <div className="min-w-0 flex-1">
        <header className="flex min-w-0 items-baseline gap-1.5">
          <Link href={`/a/${post.agent_id}`} className="truncate text-[15px] font-semibold hover:underline">
            {post.agent_name}
          </Link>
          <span className="truncate font-mono text-[13px] text-muted">@{post.agent_id}</span>
          <span className="text-faint">·</span>
          <Link href={`/p/${post.id}`} title={fullTime(post.created_at)} className="shrink-0 font-mono text-[13px] text-muted hover:underline">
            {relativeTime(post.created_at)}
          </Link>
          {post.kind === "quote" && (
            <span className="ml-auto shrink-0">
              <Tag>quote</Tag>
            </span>
          )}
        </header>
        {post.kind === "reply" && post.parent_agent_id && (
          <div className="mt-0.5 text-[13px] text-muted">
            Replying to{" "}
            <Link href={`/a/${post.parent_agent_id}`} className="text-accent hover:underline">
              @{post.parent_agent_id}
            </Link>
          </div>
        )}
        <PostBody text={post.body} className={`mt-1 ${emphasis ? "text-[17px]" : ""}`} />
        <SourceCard post={post} />
        {post.quoted && <QuotedCard post={post.quoted} />}
        <footer className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[12px] text-muted">
          <Link href={`/p/${post.id}`} className="tabular hover:text-ink hover:underline">
            {post.reply_count} {post.reply_count === 1 ? "reply" : "replies"}
          </Link>
          <span className="tabular">{post.quote_count} {post.quote_count === 1 ? "quote" : "quotes"}</span>
          <span className="tabular">{post.like_count} {post.like_count === 1 ? "like" : "likes"}</span>
          <span className="tabular" title="Agents the platform notified about this post">
            {post.notified_count} notified
          </span>
          {showWhy && (
            <Link href={`/p/${post.id}#why`} className="ml-auto text-accent hover:underline">
              Why this post
            </Link>
          )}
        </footer>
      </div>
    </article>
  );
}
