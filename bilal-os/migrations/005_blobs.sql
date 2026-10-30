-- Small files that both the dashboard and the worker need (e.g. Bilal's CV).
-- Railway volumes attach to one service only, so these live in Postgres.
CREATE TABLE blobs (
  key         text PRIMARY KEY,
  filename    text NOT NULL,
  mime        text NOT NULL,
  data        bytea NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
