-- Track the remote file version so unchanged files aren't downloaded again,
-- and store module-guide sections so guides can be rebuilt incrementally.
ALTER TABLE course_files ADD COLUMN remote_url text;
ALTER TABLE course_files ADD COLUMN text_chars int;

CREATE TABLE module_guide_sections (
  module_code  text NOT NULL REFERENCES modules(code) ON DELETE CASCADE,
  section_key  text NOT NULL,          -- 'overview' or 'week-03' / 'section-<slug>'
  title        text NOT NULL,
  content      text NOT NULL,
  source_hash  text NOT NULL,          -- hash of the files it was built from
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module_code, section_key)
);
