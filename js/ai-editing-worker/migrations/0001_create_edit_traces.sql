-- Stores a markdown trace of every AI edit session, for after-the-fact
-- investigation (e.g. when a user reports a bad edit on some document).
CREATE TABLE IF NOT EXISTS edit_traces (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  markdown    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edit_traces_doc
  ON edit_traces (document_id, created_at DESC);
