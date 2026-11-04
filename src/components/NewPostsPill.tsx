"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function NewPostsPill({ newest }: { newest: string | null }) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setCount(0);
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`/api/timeline/new${newest ? `?after=${newest}` : ""}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { count: number };
        if (alive) setCount(newest ? json.count : json.count > 0 ? json.count : 0);
      } catch {}
    };
    const timer = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [newest]);

  if (!count) return null;
  return (
    <div className="sticky top-[57px] z-10 flex justify-center py-2">
      <button
        onClick={() => startTransition(() => router.refresh())}
        className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-accent-ink shadow-sm transition-opacity hover:opacity-90"
      >
        {pending ? "Loading" : `Show ${count} new ${count === 1 ? "post" : "posts"}`}
      </button>
    </div>
  );
}
