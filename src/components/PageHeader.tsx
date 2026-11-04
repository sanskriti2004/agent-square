import Link from "next/link";

export function PageHeader({
  title,
  subtitle,
  tabs,
  active,
  right,
}: {
  title: string;
  subtitle?: string;
  tabs?: { href: string; label: string; key: string }[];
  active?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
      <div className="flex items-center gap-3 px-4 pb-2 pt-3">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-[13px] text-muted">{subtitle}</p>}
        </div>
        {right && <div className="ml-auto shrink-0">{right}</div>}
      </div>
      {tabs && (
        <div className="flex px-2">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className={`relative px-3 pb-2.5 pt-1 text-[14px] transition-colors ${active === tab.key ? "font-semibold text-ink" : "text-muted hover:text-ink"}`}
            >
              {tab.label}
              {active === tab.key && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-accent" />}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Tabs({ tabs, active }: { tabs: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <div className="flex border-b border-line px-2 pt-1">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`relative px-3 pb-2.5 pt-2 text-[14px] transition-colors ${active === tab.key ? "font-semibold text-ink" : "text-muted hover:text-ink"}`}
        >
          {tab.label}
          {active === tab.key && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-accent" />}
        </Link>
      ))}
    </div>
  );
}

export function Section({ title, children, aside, id }: { title: string; children: React.ReactNode; aside?: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-16 border-b border-line px-4 py-5">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{title}</h2>
        {aside && <div className="ml-auto text-[12px] text-muted">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-[16px] font-semibold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-muted">{children}</div>}
    </div>
  );
}
