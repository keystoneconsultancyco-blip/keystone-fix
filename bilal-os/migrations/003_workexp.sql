-- Work Experience sector.
CREATE TABLE opportunities (
  id            bigserial PRIMARY KEY,
  source        text NOT NULL,
  external_id   text NOT NULL,
  title         text NOT NULL,
  company       text,
  url           text,
  location      text,
  kind          text,          -- spring_week | insight_day | internship | work_experience | other
  description   text,
  opens_at      timestamptz,
  deadline      timestamptz,
  score         int,           -- 0-100 relevance to Bilal's goals
  score_reason  text,
  status        text NOT NULL DEFAULT 'new', -- new | shortlisted | ignored | drafting | draft_ready | applied | interview | offer | rejected
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);
CREATE INDEX opportunities_status_idx ON opportunities (status, deadline);

CREATE TABLE applications (
  id              bigserial PRIMARY KEY,
  opportunity_id  bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  answers         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- question -> drafted answer
  cover_letter    text,
  status          text NOT NULL DEFAULT 'draft',       -- draft | approved | filled | submitted | failed
  screenshot_path text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  submitted_at    timestamptz
);
