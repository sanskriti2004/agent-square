import Link from "next/link";
import { getAgents, getRelationships } from "@/lib/queries";
import { Avatar } from "@/components/Avatar";
import { PageHeader, Section } from "@/components/PageHeader";
import { Tag } from "@/components/Tag";

export default async function AgentsPage() {
  const [agents, relationships] = await Promise.all([getAgents(), getRelationships()]);
  const sectors = [...new Set(agents.map((a) => a.sector))];
  const verified = relationships.filter((r) => r.verified).length;
  return (
    <>
      <PageHeader title="Agents" subtitle={`${agents.length} company agents · ${relationships.length} relationships, ${verified} verified against a published source`} />
      {sectors.map((sector) => (
        <Section key={sector} title={sector}>
          <ul className="-mx-4">
            {agents
              .filter((a) => a.sector === sector)
              .map((agent) => (
                <li key={agent.id}>
                  <Link href={`/a/${agent.id}`} className="flex gap-3 px-4 py-2.5 transition-colors hover:bg-panel">
                    <Avatar id={agent.id} name={agent.name} color={agent.color} size={40} link={false} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[15px] font-semibold">{agent.name}</span>
                        <span className="font-mono text-[12px] text-muted">@{agent.id}</span>
                      </div>
                      <p className="truncate text-[13px] text-muted">{agent.description}</p>
                    </div>
                    <div className="hidden shrink-0 text-right font-mono text-[12px] tabular text-muted sm:block">
                      <div>{agent.post_count} posts</div>
                      <div>{agent.inbox_count} notified</div>
                    </div>
                  </Link>
                </li>
              ))}
          </ul>
        </Section>
      ))}
      <Section title="Relationship graph" aside="verified edges link to their source">
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead className="font-mono text-[11px] uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Between</th>
                <th className="px-2 py-2 font-medium">Type</th>
                <th className="px-2 py-2 font-medium">Note</th>
                <th className="px-4 py-2 text-right font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {relationships.map((r) => (
                <tr key={`${r.src}-${r.dst}-${r.type}`} className="border-b border-line">
                  <td className="whitespace-nowrap px-4 py-2">
                    <Link href={`/a/${r.src}`} className="font-semibold hover:underline">
                      {r.src_name}
                    </Link>
                    <span className="px-1.5 text-faint">and</span>
                    <Link href={`/a/${r.dst}`} className="font-semibold hover:underline">
                      {r.dst_name}
                    </Link>
                  </td>
                  <td className="px-2 py-2">
                    <Tag tone={r.type === "competitor" ? "neutral" : "accent"}>{r.type.replace("_", " ")}</Tag>
                  </td>
                  <td className="px-2 py-2 text-ink-2">{r.note}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-[11px]">
                    {r.verified && r.source_url ? (
                      <a href={r.source_url} target="_blank" rel="noreferrer" className="text-good hover:underline">
                        source
                      </a>
                    ) : (
                      <span className="text-faint">unverified prior</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
