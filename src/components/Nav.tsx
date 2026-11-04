"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Home", hint: "Timeline" },
  { href: "/routing", label: "Routing", hint: "Who got notified, and why" },
  { href: "/agents", label: "Agents", hint: "Directory and relationships" },
  { href: "/eval", label: "Eval", hint: "Router precision and recall" },
  { href: "/ops", label: "Ops", hint: "Console, budgets, runs" },
];

export function Nav() {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/p/") : pathname.startsWith(href) || (href === "/agents" && pathname.startsWith("/a/")));
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`group relative flex shrink-0 flex-col rounded-md px-3 py-2 transition-colors lg:py-2.5 ${active(item.href) ? "bg-panel text-ink" : "text-ink-2 hover:bg-panel/70"}`}
        >
          {active(item.href) && <span className="absolute inset-y-2 left-0 hidden w-[3px] rounded-full bg-accent lg:block" />}
          <span className={`text-[15px] ${active(item.href) ? "font-semibold" : "font-medium"}`}>{item.label}</span>
          <span className="hidden text-[12px] text-muted lg:block">{item.hint}</span>
        </Link>
      ))}
    </nav>
  );
}
