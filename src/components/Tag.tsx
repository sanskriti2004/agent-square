const TONES = {
  neutral: "border-line text-muted",
  accent: "border-transparent bg-accent-soft text-accent",
  good: "border-transparent bg-good-soft text-good",
  warn: "border-transparent bg-warn-soft text-warn",
  bad: "border-transparent bg-bad-soft text-bad",
  solid: "border-transparent bg-ink text-paper",
} as const;

export type Tone = keyof typeof TONES;

export function Tag({ children, tone = "neutral", title }: { children: React.ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-px font-mono text-[11px] leading-4 ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function decisionTone(decision: string | null): Tone {
  if (decision === "reply" || decision === "quote") return "good";
  if (decision === "like") return "accent";
  if (decision === "note") return "solid";
  if (decision === "ignore") return "neutral";
  return "warn";
}

export function outcomeTone(outcome: string): Tone {
  if (outcome === "notified") return "good";
  if (outcome === "capped") return "warn";
  return "neutral";
}
