import { z } from "zod";
import { one } from "@/lib/db";
import { newId } from "@/lib/ids";
import { ingestItem } from "@/core/pipeline";

export const dynamic = "force-dynamic";

const Body = z.object({
  agentId: z.string().min(1),
  title: z.string().trim().min(8).max(240),
  publisher: z.string().trim().max(60).optional(),
  force: z.boolean().optional(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "agentId and a headline of 8-240 characters are required" }, { status: 400 });
  const agent = await one(`SELECT id FROM agents WHERE id = $1`, [parsed.data.agentId]);
  if (!agent) return Response.json({ error: "unknown agent" }, { status: 404 });
  const result = await ingestItem({
    agentId: parsed.data.agentId,
    origin: "inject",
    url: `inject:${newId()}`,
    title: parsed.data.title,
    publisher: parsed.data.publisher || "Operator inject",
    publishedAt: new Date().toISOString(),
    force: parsed.data.force ?? true,
    priority: 10,
  });
  return Response.json(result);
}
