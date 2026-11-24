-- Autodesk Fusion imports (crates/fusion_import). One row per APS item (a
-- lineage URN) a user imported, linked to the Macro file document its
-- versions become; one row per APS version the import has seen, imported or
-- not, so a re-sync adds only versions it has not recorded.
--
-- No foreign key to "Document": the link row is written, with the document
-- id chosen up front, before the document exists, so a retry reuses the id.
-- A linked document that is gone is found through the documents service and
-- relinked by the next import, whose cascade clears its version rows.
-- user_id has no foreign key, like import_entity.

CREATE TABLE fusion_item (
    user_id          TEXT        NOT NULL,
    item_id          TEXT        NOT NULL,  -- APS lineage URN
    project_id       TEXT        NOT NULL,  -- APS project, needed to list versions
    document_id      UUID        NOT NULL,  -- chosen before the document is created (UUIDv7)
    state            TEXT        NOT NULL DEFAULT 'creating',
    sync_lease_until TIMESTAMPTZ,           -- one sync per item at a time
    last_synced_at   TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_id),
    UNIQUE (document_id),
    CHECK (state IN ('creating', 'linked'))
);

CREATE TABLE fusion_item_version (
    user_id              TEXT        NOT NULL,
    item_id              TEXT        NOT NULL,
    version_id           TEXT        NOT NULL,  -- APS version URN
    version_number       INTEGER     NOT NULL,
    outcome              TEXT        NOT NULL,
    document_instance_id BIGINT,                -- "DocumentInstance".id when imported
    storage_size         BIGINT,
    extension            TEXT,
    upstream_created_at  TIMESTAMPTZ,
    recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_id, version_id),
    FOREIGN KEY (user_id, item_id) REFERENCES fusion_item (user_id, item_id) ON DELETE CASCADE,
    CHECK (outcome IN ('imported', 'unavailable', 'too_large', 'unsupported_format')),
    CHECK (outcome <> 'imported' OR document_instance_id IS NOT NULL)
);
