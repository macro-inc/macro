-- Immutable published versions of an artifact document. Each row is one
-- manifest: file paths to content-addressed objects plus named scenes. The
-- current version is the highest number; restoring republishes an old
-- manifest as a new number.
CREATE TABLE artifact_versions (
    document_id text NOT NULL REFERENCES "Document"(id) ON DELETE CASCADE,
    number integer NOT NULL CHECK (number > 0),
    files jsonb NOT NULL,
    scenes jsonb NOT NULL,
    message text,
    created_by text NOT NULL,
    created_by_agent text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (document_id, number)
);
