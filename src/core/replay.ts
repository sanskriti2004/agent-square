import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ReplayItem = {
  agentId: string;
  title: string;
  publisher: string | null;
  url: string;
  publishedAt: string | null;
  origin: "scenario" | "snapshot";
};

function load(file: string, origin: ReplayItem["origin"]): ReplayItem[] {
  const path = join(process.cwd(), "data", "replay", file);
  if (!existsSync(path)) return [];
  const rows = JSON.parse(readFileSync(path, "utf8")) as Omit<ReplayItem, "origin">[];
  return rows.map((row) => ({ ...row, origin }));
}

export function replayItems(): ReplayItem[] {
  const scenarios = load("scenarios.json", "scenario");
  const snapshot = load("snapshot.json", "snapshot");
  const merged: ReplayItem[] = [];
  const longest = Math.max(scenarios.length, snapshot.length);
  for (let i = 0; i < longest; i++) {
    if (scenarios[i]) merged.push(scenarios[i]);
    if (snapshot[i]) merged.push(snapshot[i]);
  }
  return merged;
}
