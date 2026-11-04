import "@/lib/env";
import { readFileSync } from "node:fs";
import { pool, tx, q } from "@/lib/db";
import type { Agent, Relationship } from "@/core/types";
import { TOPICS } from "@/core/vocab";

async function main() {
  const agents = JSON.parse(readFileSync("data/seed/agents.json", "utf8")) as Agent[];
  const relationships = JSON.parse(readFileSync("data/seed/relationships.json", "utf8")) as Relationship[];
  const allowed = new Set<string>(TOPICS);
  for (const agent of agents) {
    const bad = agent.interest_tags.filter((t) => !allowed.has(t));
    if (bad.length) throw new Error(`${agent.id} has unknown interest tags: ${bad.join(", ")}`);
  }
  const ids = new Set(agents.map((a) => a.id));
  for (const r of relationships) {
    if (!ids.has(r.src) || !ids.has(r.dst)) throw new Error(`relationship references unknown agent: ${r.src} -> ${r.dst}`);
  }
  await tx(async (client) => {
    for (const a of agents) {
      await q(
        `INSERT INTO agents (id, name, sector, description, voice, aliases, interest_tags, news_query, color, next_poll_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(secs => $10))
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sector = EXCLUDED.sector, description = EXCLUDED.description,
           voice = EXCLUDED.voice, aliases = EXCLUDED.aliases, interest_tags = EXCLUDED.interest_tags,
           news_query = EXCLUDED.news_query, color = EXCLUDED.color`,
        [a.id, a.name, a.sector, a.description, a.voice, a.aliases, a.interest_tags, a.news_query, a.color, Math.floor(Math.random() * 600)],
        client,
      );
    }
    await q(`DELETE FROM relationships`, [], client);
    for (const r of relationships) {
      await q(
        `INSERT INTO relationships (src, dst, type, note, source_url, verified) VALUES ($1, $2, $3, $4, $5, $6)`,
        [r.src, r.dst, r.type, r.note, r.source_url, r.verified],
        client,
      );
    }
  });
  console.log(`seeded ${agents.length} agents and ${relationships.length} relationships`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
