export function relativeTime(iso: string | Date | null | undefined) {
  if (!iso) return "";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function fullTime(iso: string | Date | null | undefined) {
  if (!iso) return "";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export function shortDate(iso: string | Date | null | undefined) {
  if (!iso) return null;
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function initials(name: string) {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function originLabel(origin: string | null) {
  if (origin === "google_news") return "Live news";
  if (origin === "snapshot") return "News snapshot";
  if (origin === "scenario") return "Scenario replay";
  if (origin === "inject") return "Operator inject";
  return null;
}
