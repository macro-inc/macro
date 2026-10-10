-- no-transaction
-- Fills source_items for items that predate its triggers. Keep a single statement: a SQLx
-- simple-query batch with several statements gets an implicit transaction, and COMMIT inside DO
-- is only allowed outside one.
-- Each batch locks its items as the triggers do, then rewrites their rows from scratch, so writes
-- that land during the backfill are neither lost nor counted twice. A batch that cannot get its
-- locks within lock_timeout rolls back and retries rather than holding up app writes.
DO $$
DECLARE
    item_type text;
    last_id text;
    ids text[];
BEGIN
    FOREACH item_type IN ARRAY ARRAY['document', 'chat', 'project'] LOOP
        last_id := '';
        LOOP
            PERFORM set_config('lock_timeout', '200ms', true);
            BEGIN
                EXECUTE format(
                    'SELECT array_agg(id ORDER BY id) FROM (
                         SELECT id FROM %I WHERE id > $1 ORDER BY id LIMIT 500 FOR NO KEY UPDATE) b',
                    CASE item_type WHEN 'document' THEN 'Document' WHEN 'chat' THEN 'Chat' ELSE 'Project' END)
                INTO ids USING last_id;
                IF ids IS NOT NULL THEN
                    PERFORM source_items_resync(item_type, ids);
                END IF;
            EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
                PERFORM pg_sleep(1);
                CONTINUE;
            END;
            COMMIT;
            EXIT WHEN ids IS NULL;
            last_id := ids[array_length(ids, 1)];
        END LOOP;
    END LOOP;
    ANALYZE source_items;
END $$;
