import { one, q, type Queryable } from "@/lib/db";
import { newId } from "@/lib/ids";
import { normalizeTitle } from "./vocab";

export async function assignStory(title: string, db: Queryable): Promise<string> {
  const canonical = normalizeTitle(title);
  const match = await one<{ id: string }>(
    `SELECT id FROM stories
     WHERE first_seen_at > now() - interval '72 hours'
       AND similarity(canonical_title, $1) >= 0.55
     ORDER BY similarity(canonical_title, $1) DESC
     LIMIT 1`,
    [canonical],
    db,
  );
  if (match) {
    await q(`UPDATE stories SET item_count = item_count + 1 WHERE id = $1`, [match.id], db);
    return match.id;
  }
  const id = newId();
  await q(`INSERT INTO stories (id, canonical_title) VALUES ($1, $2)`, [id, canonical], db);
  return id;
}
