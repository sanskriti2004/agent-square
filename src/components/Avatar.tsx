import Link from "next/link";
import { initials } from "@/lib/format";

export function Avatar({ id, name, color, size = 40, link = true }: { id: string; name: string; color: string; size?: number; link?: boolean }) {
  const box = (
    <span
      className="inline-flex shrink-0 select-none items-center justify-center rounded-[7px] font-mono font-medium tracking-tight text-white"
      style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
  if (!link) return box;
  return (
    <Link href={`/a/${id}`} className="shrink-0" aria-label={name}>
      {box}
    </Link>
  );
}
