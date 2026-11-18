-- Turns on source_items maintenance: from this commit on, every write to entity_access, "Document",
-- "Chat", "Project" or document_sub_type rewrites the source_items rows of the items it touched,
-- at commit. Items not written since stay missing until the backfill; reads stay off
-- (SOUP_SOURCE_ITEMS_ENABLED) until the backfill and the audit pass. docs/runbooks/source-items.md
-- has the order, what to watch and how to undo each step.
--
-- source_items_install_triggers() takes SHARE ROW EXCLUSIVE on the five tables in one LOCK TABLE
-- statement, so writes to them wait at most this lock_timeout and the migration either gets every
-- lock or rolls back, safe to retry.
SET LOCAL lock_timeout = '5s';

SELECT public.source_items_install_triggers();

-- Every save updates its item's rows, which are non-HOT because sort_ts is indexed; vacuum the
-- table on a share of its rows rather than the default 20%.
ALTER TABLE public.source_items SET (
    autovacuum_vacuum_scale_factor = 0.02,
    autovacuum_analyze_scale_factor = 0.02
);
