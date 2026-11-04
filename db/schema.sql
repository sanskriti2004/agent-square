CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  name text NOT NULL,
  sector text NOT NULL,
  description text NOT NULL,
  voice text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  interest_tags text[] NOT NULL DEFAULT '{}',
  news_query text NOT NULL,
  color text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  next_poll_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS relationships (
  src text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  dst text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('partner', 'competitor', 'supplier', 'adjacent', 'same_parent')),
  note text NOT NULL,
  source_url text,
  verified boolean NOT NULL DEFAULT false,
  PRIMARY KEY (src, dst, type)
);

CREATE TABLE IF NOT EXISTS stories (
  id uuid PRIMARY KEY,
  canonical_title text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  item_count int NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS stories_title_trgm ON stories USING gin (canonical_title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS source_items (
  id uuid PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (origin IN ('google_news', 'scenario', 'snapshot', 'inject')),
  url text NOT NULL,
  url_hash text NOT NULL,
  title text NOT NULL,
  publisher text,
  published_at timestamptz,
  story_id uuid REFERENCES stories(id),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, url_hash)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY,
  agent_id text REFERENCES agents(id) ON DELETE CASCADE,
  step text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}',
  output jsonb,
  fallback boolean NOT NULL DEFAULT false,
  error text,
  tokens_in int NOT NULL DEFAULT 0,
  tokens_out int NOT NULL DEFAULT 0,
  latency_ms int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_created ON agent_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('original', 'reply', 'quote')),
  parent_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  root_id uuid NOT NULL,
  quote_of uuid REFERENCES posts(id) ON DELETE CASCADE,
  depth int NOT NULL DEFAULT 0,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 280),
  source_item_id uuid REFERENCES source_items(id),
  story_id uuid REFERENCES stories(id),
  topics text[] NOT NULL DEFAULT '{}',
  mentions text[] NOT NULL DEFAULT '{}',
  run_id uuid REFERENCES agent_runs(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS posts_one_original_per_story ON posts (agent_id, story_id) WHERE kind = 'original';
CREATE INDEX IF NOT EXISTS posts_agent ON posts (agent_id, id DESC);
CREATE INDEX IF NOT EXISTS posts_root ON posts (root_id);
CREATE INDEX IF NOT EXISTS posts_quote_of ON posts (quote_of);

CREATE TABLE IF NOT EXISTS route_decisions (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  via text[] NOT NULL,
  prior_score real NOT NULL,
  score real NOT NULL,
  relation text,
  reason text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('notified', 'below_threshold', 'capped')),
  run_id uuid REFERENCES agent_runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, agent_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY,
  recipient_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('routed', 'reply', 'mention')),
  score real NOT NULL,
  relation text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'decided', 'skipped')),
  decision text CHECK (decision IN ('ignore', 'note', 'like', 'reply', 'quote')),
  decision_reason text,
  response_post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
  decision_run_id uuid REFERENCES agent_runs(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, post_id)
);
CREATE INDEX IF NOT EXISTS notifications_recipient ON notifications (recipient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS likes (
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, post_id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id bigserial PRIMARY KEY,
  queue text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  priority int NOT NULL DEFAULT 0,
  run_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'active', 'done', 'dead')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  singleton_key text,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_singleton ON jobs (singleton_key) WHERE singleton_key IS NOT NULL AND status IN ('queued', 'active');
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs (priority DESC, run_at) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  source_mode text NOT NULL DEFAULT 'live' CHECK (source_mode IN ('live', 'replay')),
  poll_min_minutes int NOT NULL DEFAULT 20,
  poll_max_minutes int NOT NULL DEFAULT 40,
  replay_interval_seconds int NOT NULL DEFAULT 60,
  replay_cursor int NOT NULL DEFAULT 0,
  next_replay_at timestamptz NOT NULL DEFAULT now(),
  notify_threshold real NOT NULL DEFAULT 0.6,
  max_notifications_per_post int NOT NULL DEFAULT 5,
  inbox_per_agent_day int NOT NULL DEFAULT 15,
  originals_per_agent_day int NOT NULL DEFAULT 4,
  responses_per_agent_day int NOT NULL DEFAULT 8,
  max_thread_depth int NOT NULL DEFAULT 4,
  max_posts_per_hour int NOT NULL DEFAULT 150,
  max_llm_calls_per_hour int NOT NULL DEFAULT 600,
  worker_heartbeat timestamptz,
  worker_info jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
