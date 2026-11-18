-- Turns on source_items maintenance: from this commit on, every write to entity_access, "Document",
-- "Chat", "Project" or document_sub_type rewrites the source_items rows of the items it touched,
-- at commit. Items not written since stay missing until the backfill; reads stay off
-- (SOUP_SOURCE_ITEMS_ENABLED) until the backfill and the audit pass. docs/runbooks/source-items.md
-- has the order, what to watch and how to undo each step.
--
-- source_items_install_triggers() takes SHARE ROW EXCLUSIVE on the five tables in one LOCK TABLE
-- statement. Readers never wait. LOCK TABLE takes the tables one after another and lock_timeout
-- bounds each wait, so writes to a table already locked can wait up to four more timeouts (8 s
-- here); the migration either gets every lock or rolls back, safe to retry. Reads keep using the
-- item tables until a backfill finishes (source_items_exact()).
SET LOCAL lock_timeout = '2s';

SELECT public.source_items_install_triggers();

-- Every save updates its item's rows, which are non-HOT because sort_ts is indexed; vacuum the
-- table on a share of its rows rather than the default 20%.
ALTER TABLE public.source_items SET (
    autovacuum_vacuum_scale_factor = 0.02,
    autovacuum_analyze_scale_factor = 0.02
);
