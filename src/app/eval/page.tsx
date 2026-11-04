import Link from "next/link";
import { getEvalResults } from "@/lib/queries";
import { Empty, PageHeader, Section } from "@/components/PageHeader";
import { Tag } from "@/components/Tag";
import { fullTime } from "@/lib/format";

function Bar({ value, tone }: { value: number; tone: "accent" | "ink" }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-sunk">
        <div className={`h-full rounded-full ${tone === "accent" ? "bg-accent" : "bg-ink-2"}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="w-9 text-right font-mono text-[12px] tabular">{value.toFixed(2)}</span>
    </div>
  );
}

export default async function EvalPage() {
  const { results, cases } = getEvalResults();
  if (!results) {
    return (
      <>
        <PageHeader title="Eval" />
        <Empty title="No eval results yet">
          Run <code className="font-mono text-ink-2">npm run eval</code> to score the router against the labelled cases.
        </Empty>
      </>
    );
  }
  const best = results.results.reduce((a, b) => (b.f1 > a.f1 ? b : a));
  const focus = results.results.find((r) => r.name === "hybrid-rules") ?? best;
  const byCase = new Map(focus.perCase.map((c) => [c.id, c]));

  return (
    <>
      <PageHeader title="Eval" subtitle={`Routing precision and recall · ${results.cases} posts · ${results.pairs} labelled pairs · ${results.positives} should-notify`} />
      <Section title="Strategies" aside={`run ${fullTime(results.ranAt)} · threshold ${results.threshold}`}>
        <p className="mb-4 text-[14px] leading-relaxed text-ink-2">
          Each strategy decides which of the other 19 agents to notify for each test post. Precision is the share of notifications that were deserved, recall is
          the share of deserved notifications that were sent. Precision matters more here: a missed notification costs one interaction, a wrong one teaches the
          agent to ignore its inbox.
        </p>
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-[13px]">
            <thead className="font-mono text-[11px] uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="w-[34%] px-4 py-2 font-medium">Strategy</th>
                <th className="px-2 py-2 font-medium">Precision</th>
                <th className="px-2 py-2 font-medium">Recall</th>
                <th className="px-2 py-2 font-medium">F1</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-medium">TP · FP · FN</th>
                <th className="px-4 py-2 text-right font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {results.results.map((r) => (
                <tr key={r.name} className={`border-b border-line align-top ${r.name === best.name ? "bg-panel" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 font-mono text-[13px] font-medium">
                      {r.name}
                      {r.name === best.name && <Tag tone="good">best F1</Tag>}
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">{r.description}</div>
                    {r.errors.length > 0 && <div className="mt-1 text-[11px] text-warn">{r.errors.length} judge calls fell back to rules</div>}
                  </td>
                  <td className="px-2 py-2.5">
                    <Bar value={r.precision} tone="accent" />
                  </td>
                  <td className="px-2 py-2.5">
                    <Bar value={r.recall} tone="ink" />
                  </td>
                  <td className="px-2 py-2.5 font-mono tabular">{r.f1.toFixed(2)}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular text-muted">
                    {r.tp} · {r.fp} · {r.fn}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular text-muted">{r.seconds.toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title={`Per post: ${focus.name}`} aside="green is correct, amber is a miss or a false alarm">
        <ul className="divide-y divide-line">
          {cases.map((c) => {
            const result = byCase.get(c.id);
            const predicted = new Set(result?.predicted ?? []);
            const all = [...new Set([...c.notify, ...predicted])];
            return (
              <li key={c.id} className="py-3">
                <div className="flex items-baseline gap-2">
                  <Link href={`/a/${c.author}`} className="font-mono text-[12px] text-muted hover:underline">
                    @{c.author}
                  </Link>
                  <span className="font-mono text-[11px] text-faint">{c.id}</span>
                </div>
                <p className="mt-1 text-[14px] leading-snug">{c.body}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {all.length === 0 && <Tag tone="good">nobody, correctly</Tag>}
                  {all.map((agent) => {
                    const truth = c.notify.includes(agent);
                    const hit = predicted.has(agent);
                    const tone = truth && hit ? "good" : "warn";
                    const label = truth && hit ? agent : truth ? `${agent} missed` : `${agent} false alarm`;
                    return (
                      <Tag key={agent} tone={tone}>
                        {label}
                      </Tag>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[12px] leading-snug text-muted">{c.why}</p>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}
