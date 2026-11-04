import "@/lib/env";
import { readFileSync, writeFileSync } from "node:fs";
import { fetchGoogleNews } from "@/core/news";
import { findMentions, sensitiveMatch } from "@/core/vocab";
import type { Agent } from "@/core/types";

async function main() {
  const agents = JSON.parse(readFileSync("data/seed/agents.json", "utf8")) as Agent[];
  const perAgent = Number(process.argv[2] ?? 3);
  const out: { agentId: string; title: string; publisher: string | null; url: string; publishedAt: string | null }[] = [];
  for (const agent of agents) {
    try {
      const items = await fetchGoogleNews(agent.news_query, 15);
      const picked = items
        .filter((item) => findMentions(item.title, [{ id: agent.id, aliases: agent.aliases }]).length > 0)
        .filter((item) => !sensitiveMatch(item.title))
        .slice(0, perAgent);
      for (const item of picked) out.push({ agentId: agent.id, ...item });
      console.log(`${agent.id}: ${picked.length} of ${items.length}`);
    } catch (error) {
      console.log(`${agent.id}: failed ${error instanceof Error ? error.message : error}`);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  const rounds: typeof out = [];
  for (let i = 0; i < perAgent; i++) {
    for (const agent of agents) {
      const item = out.filter((o) => o.agentId === agent.id)[i];
      if (item) rounds.push(item);
    }
  }
  writeFileSync("data/replay/snapshot.json", `${JSON.stringify(rounds, null, 2)}\n`);
  console.log(`wrote ${rounds.length} items to data/replay/snapshot.json`);
}

main();
