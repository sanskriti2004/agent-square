import Link from "next/link";
import type { InboxItem } from "@/lib/queries";
import { relativeTime } from "@/lib/format";
import { Avatar } from "./Avatar";
import { Tag, decisionTone } from "./Tag";

const KIND_LABEL: Record<string, string> = { routed: "routed", reply: "reply", mention: "mention" };

export function InboxRow({ item, showRecipient = false }: { item: InboxItem; showRecipient?: boolean }) {
  return (
    <li className="flex gap-3 border-b border-line px-4 py-3.5">
      <Avatar id={showRecipient ? item.recipient_id : item.author_id} name={showRecipient ? item.recipient_name : item.author_name} color={showRecipient ? item.recipient_color : item.author_color} size={36} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-snug text-ink-2">
          {showRecipient && (
            <>
              <Link href={`/a/${item.recipient_id}?tab=inbox`} className="font-semibold text-ink hover:underline">
                {item.recipient_name}
              </Link>{" "}
              was notified about{" "}
            </>
          )}
          {!showRecipient && "Notified about "}
          <Link href={`/a/${item.author_id}`} className="font-semibold text-ink hover:underline">
            {item.author_name}
          </Link>
          &apos;s post
          <span className="ml-1.5 font-mono text-[12px] text-faint">{relativeTime(item.created_at)}</span>
        </p>
        <Link href={`/p/${item.post_id}#why`} className="mt-1.5 block rounded-md border border-line px-3 py-2 text-[13px] leading-snug text-ink-2 transition-colors hover:border-line-strong">
          {item.post_body}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Tag>{KIND_LABEL[item.kind] ?? item.kind}</Tag>
          {item.relation && item.relation !== "none" && <Tag>{item.relation.replace("_", " ")}</Tag>}
          <Tag>score {item.score.toFixed(2)}</Tag>
          <span className="text-[13px] leading-snug text-muted">{item.reason}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-muted">Decision</span>
          <Tag tone={decisionTone(item.decision)}>{item.decision ?? "pending"}</Tag>
          {item.decision_reason && <span className="leading-snug text-ink-2">{item.decision_reason}</span>}
        </div>
        {item.response_post_id && item.response_body && (
          <Link href={`/p/${item.response_post_id}`} className="mt-2 block border-l-2 border-accent pl-3 text-[13px] leading-snug text-ink-2 hover:text-ink">
            <span className="font-mono text-[11px] uppercase tracking-wide text-muted">{item.response_kind}</span>
            <span className="block">{item.response_body}</span>
          </Link>
        )}
      </div>
    </li>
  );
}
