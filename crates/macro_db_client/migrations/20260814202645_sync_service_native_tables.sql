-- Native sync-service (sync_machine) storage.
--
-- The live document is an in-memory Loro replica; these tables are its
-- durability. Every accepted edit is appended to sync_document_op BEFORE the
-- client is acked; a debounced compaction folds the tail into sync_document
-- and deletes the covered op rows. Loading = read the snapshot, replay ops
-- with seq > snapshot_seq.
--
-- sync_peer_user and sync_blame replace the Cloudflare D1 peer_user_map and
-- blame tables.
--
-- All four tables cascade from "Document" like the other document-scoped
-- tables (DocumentText, DocumentBom, ...): a hard delete of the document
-- removes its sync state. The Cloudflare import must skip documents MacroDB
-- no longer knows about.

CREATE TABLE sync_document (
    document_id  TEXT PRIMARY KEY REFERENCES "Document" (id) ON DELETE CASCADE,
    -- A raw Loro snapshot export covering ops through snapshot_seq.
    snapshot     BYTEA       NOT NULL,
    snapshot_seq BIGINT      NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The op log tail: rows exist only between compactions (plus any orphans a
-- crash leaves behind, which the next compaction removes). References
-- "Document" rather than sync_document because ops for a brand-new document
-- are durable before its first compaction creates the sync_document row.
CREATE TABLE sync_document_op (
    document_id TEXT        NOT NULL REFERENCES "Document" (id) ON DELETE CASCADE,
    -- Assigned by the document's machine, which is the sole writer for the
    -- document while it holds it resident.
    seq         BIGINT      NOT NULL,
    payload     BYTEA       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (document_id, seq)
);

-- CRDT peer id -> user attribution (a Loro peer id is a u64; stored as the
-- lossless i64 bit pattern).
CREATE TABLE sync_peer_user (
    document_id TEXT   NOT NULL REFERENCES "Document" (id) ON DELETE CASCADE,
    peer_id     BIGINT NOT NULL,
    user_id     TEXT   NOT NULL,
    PRIMARY KEY (document_id, peer_id)
);

-- Last editor per Lexical node.
CREATE TABLE sync_blame (
    document_id     TEXT        NOT NULL REFERENCES "Document" (id) ON DELETE CASCADE,
    lexical_node_id TEXT        NOT NULL,
    peer_id         BIGINT      NOT NULL,
    edited_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (document_id, lexical_node_id)
);
