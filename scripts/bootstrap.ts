import "@/lib/env";
import { pool, q } from "@/lib/db";
import { ingestItem } from "@/core/pipeline";
import { replayItems } from "@/core/replay";

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const items = replayItems();
  const limit = limitArg ? Number(limitArg.split("=")[1]) : items.length;
  let queued = 0;
  for (const item of items.slice(0, limit)) {
    const result = await ingestItem({
      agentId: item.agentId,
      origin: item.origin,
      url: item.url,
      title: item.title,
      publisher: item.publisher,
      publishedAt: item.publishedAt,
      priority: item.origin === "scenario" ? 3 : 2,
    });
    if (result.queued) queued++;
  }
  await q(`UPDATE settings SET replay_cursor = GREATEST(replay_cursor, $1) WHERE id = 1`, [Math.min(limit, items.length)]);
  console.log(`ingested ${Math.min(limit, items.length)} replay items, queued ${queued} editor jobs. Start the worker (npm run worker) to process them.`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
