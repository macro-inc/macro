-- Locks the items a refresh rebuilds. Row locks come first: a writer that
-- already updated an item holds its row lock, so taking the row lock before the
-- advisory lock keeps one order for both. The advisory locks read the row-lock
-- count, so they run only after every row lock is held.
--
-- Advisory locks stay in PostgreSQL's shared lock table until commit, so a
-- transaction takes them only while its running total, kept in a
-- transaction-local setting, stays within $3.
WITH documents AS MATERIALIZED (
    SELECT id FROM "Document"
    WHERE $1 = 'document' AND id = ANY($2)
    ORDER BY id
    FOR NO KEY UPDATE
), chats AS MATERIALIZED (
    SELECT id FROM "Chat"
    WHERE $1 = 'chat' AND id = ANY($2)
    ORDER BY id
    FOR NO KEY UPDATE
), projects AS MATERIALIZED (
    SELECT id FROM "Project"
    WHERE $1 = 'project' AND id = ANY($2)
    ORDER BY id
    FOR NO KEY UPDATE
), locked AS MATERIALIZED (
    SELECT (SELECT count(*) FROM documents)
         + (SELECT count(*) FROM chats)
         + (SELECT count(*) FROM projects) AS rows
), held AS MATERIALIZED (
    -- A setting reset at transaction end reads as '' rather than NULL.
    SELECT coalesce(nullif(current_setting('source_items.advisory_locks', true), ''), '0')::int
        AS keys
)
SELECT current_setting('transaction_isolation') AS "isolation!"
FROM locked
CROSS JOIN held
CROSS JOIN LATERAL (
    SELECT count(pg_advisory_xact_lock(hashtextextended($1 || ':' || ids.id, 7316)))::int AS keys
    FROM (SELECT DISTINCT unnest($2::text[]) AS id ORDER BY id) ids
    WHERE locked.rows >= 0 AND held.keys + cardinality($2) <= $3
) advisory
WHERE set_config('source_items.advisory_locks', (held.keys + advisory.keys)::text, true) IS NOT NULL
