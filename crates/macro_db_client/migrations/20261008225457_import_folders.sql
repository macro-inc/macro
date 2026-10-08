-- Folders (projects) an import created to mirror the source's structure,
-- keyed by the source object they stand for, so re-runs reuse them instead of
-- creating duplicates. A new table: existing import rows are untouched.
CREATE TABLE IF NOT EXISTS import_folder (
    user_id    TEXT NOT NULL,
    source     TEXT NOT NULL,
    -- The source object's stable id (a Notion page or database id); '' is the
    -- source's root folder (e.g. "Notion").
    foreign_id TEXT NOT NULL,
    -- A purged project takes its mapping with it; a soft-deleted one is
    -- detected and replaced by the importer.
    project_id TEXT NOT NULL REFERENCES "Project" (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, source, foreign_id),
    CHECK (source IN ('linear', 'notion', 'slack'))
);

-- The cascade above looks mappings up by project.
CREATE INDEX IF NOT EXISTS import_folder_project_idx ON import_folder (project_id);
