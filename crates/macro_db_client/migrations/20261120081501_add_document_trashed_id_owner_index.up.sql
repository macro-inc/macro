-- no-transaction
-- One statement: SQLx sends nontransactional migrations as one query.
-- The documents in the Trash, by id, with their owner, so the accessible-items
-- lookup can check a granted document's Trash state on every call without
-- reading the Document heap or the live-document index. Only trashed rows
-- enter it, so it stays small enough to stay cached.
-- An interrupted build leaves an INVALID index: check `SELECT indisvalid FROM
-- pg_index WHERE indexrelid = to_regclass('idx_document_trashed_id_owner')`,
-- and if false run `DROP INDEX CONCURRENTLY idx_document_trashed_id_owner`
-- before retrying.
CREATE INDEX CONCURRENTLY idx_document_trashed_id_owner
    ON "Document" (id) INCLUDE (owner) WHERE "deletedAt" IS NOT NULL;
