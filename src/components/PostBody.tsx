import Link from "next/link";

export function PostBody({ text, className = "", plain = false }: { text: string; className?: string; plain?: boolean }) {
  const parts = text.split(/(@[a-z0-9_]+)/gi);
  return (
    <p className={`whitespace-pre-wrap break-words text-[15px] leading-[1.45] text-ink ${className}`}>
      {parts.map((part, i) =>
        /^@[a-z0-9_]+$/i.test(part) && plain ? (
          <span key={i} className="text-accent">
            {part}
          </span>
        ) : /^@[a-z0-9_]+$/i.test(part) ? (
          <Link key={i} href={`/a/${part.slice(1).toLowerCase()}`} className="text-accent hover:underline">
            {part}
          </Link>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}
