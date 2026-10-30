-- Uni Tutor sector.
CREATE TABLE modules (
  code              text PRIMARY KEY,         -- e.g. EC1101
  name              text NOT NULL,
  moodle_course_id  text,
  moodle_url        text,
  drive_folder_id   text,
  guide_doc_id      text,
  guide_updated_at  timestamptz,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE course_files (
  id             bigserial PRIMARY KEY,
  module_code    text NOT NULL REFERENCES modules(code) ON DELETE CASCADE,
  source_url     text NOT NULL UNIQUE,
  name           text NOT NULL,
  section        text,
  week           int,
  kind           text,          -- lecture | seminar | reading | assessment | other
  mime           text,
  local_path     text,
  sha256         text,
  size_bytes     bigint,
  drive_file_id  text,
  drive_synced_at timestamptz,
  downloaded_at  timestamptz,
  indexed_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE doc_chunks (
  id           bigserial PRIMARY KEY,
  file_id      bigint NOT NULL REFERENCES course_files(id) ON DELETE CASCADE,
  module_code  text NOT NULL,
  chunk_index  int NOT NULL,
  content      text NOT NULL,
  embedding    vector(384) NOT NULL
);
CREATE INDEX doc_chunks_module_idx ON doc_chunks (module_code);
CREATE INDEX doc_chunks_embedding_idx ON doc_chunks USING hnsw (embedding vector_cosine_ops);
