import { q, type Queryable, pool } from "@/lib/db";
import type { Agent, Relationship, RelationType } from "./types";

export type Directory = {
  agents: Agent[];
  byId: Map<string, Agent>;
  relationships: Relationship[];
  edgesFor: (a: string, b: string) => Relationship[];
};

export async function loadDirectory(db: Queryable = pool): Promise<Directory> {
  const agents = await q<Agent>(`SELECT * FROM agents ORDER BY name`, [], db);
  const relationships = await q<Relationship>(`SELECT * FROM relationships`, [], db);
  const byId = new Map(agents.map((a) => [a.id, a]));
  return {
    agents,
    byId,
    relationships,
    edgesFor: (a, b) => relationships.filter((r) => (r.src === a && r.dst === b) || (r.src === b && r.dst === a)),
  };
}

export function edgeTypes(edges: Relationship[]): RelationType[] {
  return edges.map((e) => e.type);
}
