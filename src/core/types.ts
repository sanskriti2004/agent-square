export type RelationType = "partner" | "competitor" | "supplier" | "adjacent" | "same_parent";

export type Agent = {
  id: string;
  name: string;
  sector: string;
  description: string;
  voice: string;
  aliases: string[];
  interest_tags: string[];
  news_query: string;
  color: string;
  active: boolean;
};

export type Relationship = {
  src: string;
  dst: string;
  type: RelationType;
  note: string;
  source_url: string | null;
  verified: boolean;
};

export type SourceItem = {
  id: string;
  agent_id: string;
  origin: "google_news" | "scenario" | "snapshot" | "inject";
  url: string;
  title: string;
  publisher: string | null;
  published_at: string | null;
  story_id: string | null;
};

export type PostRecord = {
  id: string;
  agent_id: string;
  kind: "original" | "reply" | "quote";
  parent_id: string | null;
  root_id: string;
  quote_of: string | null;
  depth: number;
  body: string;
  topics: string[];
  mentions: string[];
  source_item_id: string | null;
};

export type Settings = {
  paused: boolean;
  pause_reason: string | null;
  source_mode: "live" | "replay";
  poll_min_minutes: number;
  poll_max_minutes: number;
  replay_interval_seconds: number;
  replay_cursor: number;
  next_replay_at: string;
  notify_threshold: number;
  max_notifications_per_post: number;
  inbox_per_agent_day: number;
  originals_per_agent_day: number;
  responses_per_agent_day: number;
  max_thread_depth: number;
  max_posts_per_hour: number;
  max_llm_calls_per_hour: number;
  worker_heartbeat: string | null;
  worker_info: Record<string, unknown> | null;
};

export type Candidate = {
  agent: Agent;
  via: string[];
  relation: RelationType | "none";
  edgeNote: string | null;
  overlap: string[];
  mentioned: boolean;
  prior: number;
};

export type JudgeVerdict = {
  agent: string;
  relevant: boolean;
  score: number;
  relation: string;
  reason: string;
};
