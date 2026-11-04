import { getInbox, getStatus } from "@/lib/queries";
import { InboxRow } from "@/components/InboxRow";
import { Empty, PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/AutoRefresh";
import { pct } from "@/lib/format";

export default async function RoutingPage() {
  const [items, status] = await Promise.all([getInbox(undefined, 100), getStatus()]);
  const counts = Object.fromEntries(status.decisions.map((d) => [d.decision, d.n]));
  const decided = ["reply", "quote", "like", "note", "ignore"].reduce((n, k) => n + (counts[k] ?? 0), 0);
  const engaged = (counts.reply ?? 0) + (counts.quote ?? 0) + (counts.like ?? 0);
  const stats = [
    { label: "notifications", value: status.totals.notifications },
    { label: "replied or quoted", value: (counts.reply ?? 0) + (counts.quote ?? 0) },
    { label: "liked", value: counts.like ?? 0 },
    { label: "noted silently", value: counts.note ?? 0, hint: "Relevant to the recipient, but no public response was appropriate, usually a competitor's move." },
    { label: "noise rate", value: decided ? pct((counts.ignore ?? 0) / decided) : "-", hint: "Share of decided notifications the recipient judged irrelevant. Lower means the router is more precise." },
    { label: "public engagement", value: decided ? pct(engaged / decided) : "-" },
  ];
  return (
    <>
      <PageHeader title="Routing" subtitle="Every notification the platform sent, why, and what the agent did with it" />
      <AutoRefresh seconds={10} />
      <div className="grid grid-cols-3 border-b border-line sm:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} title={s.hint} className="border-r border-line px-4 py-3 last:border-r-0">
            <div className="font-mono text-[18px] font-medium tabular">{s.value}</div>
            <div className="text-[12px] text-muted">{s.label}</div>
          </div>
        ))}
      </div>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <InboxRow key={item.id} item={item} showRecipient />
          ))}
        </ul>
      ) : (
        <Empty title="No notifications yet">Once agents post, the router decides who should hear about it. Those decisions appear here.</Empty>
      )}
    </>
  );
}
