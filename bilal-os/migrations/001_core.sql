-- Core tables shared by every sector and agent.
CREATE EXTENSION IF NOT EXISTS vector;

-- Plain (non-secret) settings, editable from the dashboard.
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Secrets: AES-256-GCM ciphertext only. Never returned to the browser in full.
CREATE TABLE secrets (
  key         text PRIMARY KEY,
  ciphertext  text NOT NULL,
  hint        text,              -- last 4 characters, for display
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Single dashboard user.
CREATE TABLE auth_user (
  id               int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  password_hash    text NOT NULL,
  totp_secret_enc  text,
  totp_enabled     boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          text PRIMARY KEY,   -- sha256 of the cookie token
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  user_agent  text,
  mfa_passed  boolean NOT NULL DEFAULT false
);

CREATE TABLE login_attempts (
  id      bigserial PRIMARY KEY,
  ts      timestamptz NOT NULL DEFAULT now(),
  ip      text,
  success boolean NOT NULL
);

CREATE TABLE sectors (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  icon        text NOT NULL DEFAULT '◆',
  description text,
  builtin     boolean NOT NULL DEFAULT false,
  sort        int NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agents (
  id           text PRIMARY KEY,
  sector_id    text NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  enabled      boolean NOT NULL DEFAULT true,
  schedule     text,
  essential    boolean NOT NULL DEFAULT false,
  last_run_at  timestamptz,
  last_status  text,
  next_run_at  timestamptz,
  registered   boolean NOT NULL DEFAULT true,  -- false if the code module was removed
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_runs (
  id           bigserial PRIMARY KEY,
  agent_id     text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  trigger      text NOT NULL DEFAULT 'schedule',
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'running', -- running | success | failed | skipped
  summary      text,
  error        text
);
CREATE INDEX agent_runs_agent_idx ON agent_runs (agent_id, started_at DESC);

CREATE TABLE activity_log (
  id         bigserial PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT now(),
  sector_id  text,
  agent_id   text,
  run_id     bigint,
  level      text NOT NULL DEFAULT 'info', -- debug | info | warn | error
  message    text NOT NULL,
  data       jsonb
);
CREATE INDEX activity_log_ts_idx ON activity_log (ts DESC);
CREATE INDEX activity_log_sector_idx ON activity_log (sector_id, ts DESC);

CREATE TABLE alerts (
  id           bigserial PRIMARY KEY,
  ts           timestamptz NOT NULL DEFAULT now(),
  sector_id    text,
  agent_id     text,
  severity     text NOT NULL, -- info | important | crucial
  title        text NOT NULL,
  body         text,
  url          text,
  dedupe_key   text,
  read_at      timestamptz,
  notified_at  timestamptz,
  digest_at    timestamptz    -- when it was included in a briefing
);
CREATE INDEX alerts_open_idx ON alerts (read_at, ts DESC);
CREATE UNIQUE INDEX alerts_dedupe_idx ON alerts (dedupe_key) WHERE dedupe_key IS NOT NULL AND read_at IS NULL;

CREATE TABLE approvals (
  id             bigserial PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  sector_id      text NOT NULL,
  agent_id       text NOT NULL,
  kind           text NOT NULL,
  title          text NOT NULL,
  summary        text,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         text NOT NULL DEFAULT 'pending', -- pending | approved | rejected | done | failed
  decided_at     timestamptz,
  decision_note  text,
  result         jsonb
);
CREATE INDEX approvals_status_idx ON approvals (status, created_at DESC);

CREATE TABLE tasks (
  id           bigserial PRIMARY KEY,
  title        text NOT NULL,
  notes        text,
  due_at       timestamptz,
  remind_at    timestamptz,
  reminded_at  timestamptz,
  done_at      timestamptz,
  sector_id    text DEFAULT 'pa',
  source       text NOT NULL DEFAULT 'manual',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deadlines (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL,
  due_at      timestamptz NOT NULL,
  sector_id   text NOT NULL,
  source      text NOT NULL,
  source_ref  text,
  url         text,
  detail      text,
  done        boolean NOT NULL DEFAULT false,
  warned      text[] NOT NULL DEFAULT '{}', -- which reminders were sent: '7d','2d','1d','3h'
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_ref)
);

CREATE TABLE calendar_events (
  id          text PRIMARY KEY,           -- source:externalId
  source      text NOT NULL,              -- google | timetable
  title       text NOT NULL,
  location    text,
  start_at    timestamptz NOT NULL,
  end_at      timestamptz NOT NULL,
  all_day     boolean NOT NULL DEFAULT false,
  data        jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calendar_events_start_idx ON calendar_events (start_at);

CREATE TABLE llm_usage (
  id             bigserial PRIMARY KEY,
  ts             timestamptz NOT NULL DEFAULT now(),
  agent_id       text,
  model          text NOT NULL,
  purpose        text,
  input_tokens   int NOT NULL DEFAULT 0,
  output_tokens  int NOT NULL DEFAULT 0,
  cache_read     int NOT NULL DEFAULT 0,
  cache_write    int NOT NULL DEFAULT 0,
  cost_gbp       numeric(12,6) NOT NULL DEFAULT 0
);
CREATE INDEX llm_usage_ts_idx ON llm_usage (ts);

-- Tracks repeated failures so we alert once, not on every retry.
CREATE TABLE failure_tracker (
  key                   text PRIMARY KEY,
  consecutive_failures  int NOT NULL DEFAULT 0,
  last_error            text,
  alerted_at            timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE heartbeats (
  service  text PRIMARY KEY,
  ts       timestamptz NOT NULL DEFAULT now(),
  info     jsonb
);

-- Commands from the dashboard to the worker (run now, approval decided, ...).
CREATE TABLE commands (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  taken_at    timestamptz
);

CREATE TABLE telegram_messages (
  id         bigserial PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT now(),
  direction  text NOT NULL, -- in | out
  text       text NOT NULL
);

-- Generic per-agent key/value state (cursors, last-seen ids, etc.).
CREATE TABLE agent_state (
  agent_id  text NOT NULL,
  key       text NOT NULL,
  value     jsonb NOT NULL,
  PRIMARY KEY (agent_id, key)
);
