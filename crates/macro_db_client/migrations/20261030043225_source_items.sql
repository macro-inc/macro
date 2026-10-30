-- One row per (source, item) for every document, chat and project a source can see, so soup can
-- read a principal's items newest first from one index. Access lives in entity_access and the sort
-- key on each item table, and no index can cover both.
--
-- `grants` counts the entity_access rows behind a row. `sort_ts` is the item's "updatedAt", or
-- NULL while the item is soft-deleted, so readers filter on `sort_ts IS NOT NULL`. `kind` splits
-- tasks from other documents.
--
-- Triggers keep the table equal to what entity_access, the item tables and document_sub_type say,
-- for every writer: application code, foreign-key cascades, scripts, and fixtures loaded in replica
-- mode alike. crates/source_items holds the backfill, the audit and the tests.
--
-- How, under READ COMMITTED (the triggers refuse other isolation levels, whose older snapshots
-- could miss a concurrent change):
--   * Statement triggers only record what changed in a session temporary table. They take no
--     locks, so a writer waits on nothing it did not wait on before.
--   * At commit, a deferred trigger locks the source_items_mutex rows of the touched items in one
--     statement, in bucket order, then rewrites their rows in later statements, which read what the
--     previous holder of each bucket committed. A transaction at commit waits only for other
--     transactions at commit, which never wait on application locks, so these waits cannot form a
--     cycle with application lock orders. Mutex rows are row locks, so no transaction can fill the
--     shared lock table however many items it touches.
--   * Grant changes rewrite only the (item, source) rows they touched; saves rewrite only sort keys;
--     inserts, deletes and subtype changes rewrite the item's rows.
SET LOCAL lock_timeout = '5s';

CREATE TABLE source_items (
    source_id text NOT NULL,
    entity_type text NOT NULL CHECK (entity_type IN ('document', 'chat', 'project')),
    kind text NOT NULL CHECK (kind IN ('document', 'task', 'chat', 'project')),
    entity_id text NOT NULL,
    sort_ts timestamp(3),
    grants int NOT NULL CHECK (grants > 0),
    PRIMARY KEY (entity_type, entity_id, source_id)
);

CREATE INDEX source_items_read
    ON source_items (source_id, kind, sort_ts DESC, entity_id DESC)
    WHERE sort_ts IS NOT NULL;

-- One row per bucket of items, created when first needed; an item's bucket is
-- source_items_bucket. 2^22 buckets keep unrelated items from sharing one, even when a single
-- transaction touches hundreds of thousands.
CREATE TABLE source_items_mutex (bucket int PRIMARY KEY);

CREATE FUNCTION source_items_bucket(p_type text, p_id text) RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT hashtext(p_type || ':' || p_id) & 4194303
$$;

CREATE FUNCTION source_items_require_read_committed() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'changes to source_items inputs require READ COMMITTED isolation'
            USING ERRCODE = 'invalid_transaction_state';
    END IF;
END $$;

-- The listing state of whichever of p_ids exist.
CREATE FUNCTION source_items_state(p_type text, p_ids text[])
RETURNS TABLE (entity_id text, kind text, sort_ts timestamp(3))
LANGUAGE sql STABLE AS $$
    SELECT d.id,
           CASE WHEN st.sub_type = 'task' THEN 'task' ELSE 'document' END,
           CASE WHEN d."deletedAt" IS NULL THEN d."updatedAt" END
    FROM "Document" d
    LEFT JOIN document_sub_type st ON st.document_id = d.id
    WHERE p_type = 'document' AND d.id = ANY (p_ids)
    UNION ALL
    SELECT c.id, 'chat', CASE WHEN c."deletedAt" IS NULL THEN c."updatedAt" END
    FROM "Chat" c
    WHERE p_type = 'chat' AND c.id = ANY (p_ids)
    UNION ALL
    SELECT p.id, 'project', CASE WHEN p."deletedAt" IS NULL THEN p."updatedAt" END
    FROM "Project" p
    WHERE p_type = 'project' AND p.id = ANY (p_ids)
$$;

-- Rewrites every row of p_ids from entity_access and the item tables. Callers hold the items'
-- buckets and call this in a statement of its own.
CREATE FUNCTION source_items_rebuild(p_type text, p_ids text[]) RETURNS void
LANGUAGE sql AS $$
    WITH wanted AS (
        SELECT ea.source_id, i.entity_id, i.kind, i.sort_ts, count(*)::int AS grants
        FROM source_items_state(p_type, p_ids) i
        JOIN entity_access ea ON ea.entity_id::text = i.entity_id AND ea.entity_type = p_type
        GROUP BY ea.source_id, i.entity_id, i.kind, i.sort_ts
    ), stale AS (
        DELETE FROM source_items s
        WHERE s.entity_type = p_type AND s.entity_id = ANY (p_ids)
          AND NOT EXISTS (
              SELECT 1 FROM wanted w WHERE w.entity_id = s.entity_id AND w.source_id = s.source_id
          )
    )
    INSERT INTO source_items AS s (source_id, entity_type, kind, entity_id, sort_ts, grants)
    SELECT source_id, p_type, kind, entity_id, sort_ts, grants FROM wanted
    ON CONFLICT (entity_type, entity_id, source_id) DO UPDATE
    SET kind = EXCLUDED.kind, sort_ts = EXCLUDED.sort_ts, grants = EXCLUDED.grants
    WHERE (s.kind, s.sort_ts, s.grants)
          IS DISTINCT FROM (EXCLUDED.kind, EXCLUDED.sort_ts, EXCLUDED.grants)
$$;

-- Rewrites only the rows of the (p_ids[i], p_sources[i]) pairs. Callers hold the items' buckets
-- and call this in a statement of its own.
CREATE FUNCTION source_items_rebuild_sources(p_type text, p_ids text[], p_sources text[])
RETURNS void
LANGUAGE sql AS $$
    WITH keys AS (
        SELECT DISTINCT k.entity_id, k.source_id
        FROM unnest(p_ids, p_sources) AS k(entity_id, source_id)
    ), wanted AS (
        SELECT k.source_id, i.entity_id, i.kind, i.sort_ts, count(*)::int AS grants
        FROM keys k
        JOIN source_items_state(p_type, p_ids) i ON i.entity_id = k.entity_id
        JOIN entity_access ea
          ON ea.entity_id::text = k.entity_id AND ea.entity_type = p_type AND ea.source_id = k.source_id
        GROUP BY k.source_id, i.entity_id, i.kind, i.sort_ts
    ), stale AS (
        DELETE FROM source_items s
        USING keys k
        WHERE s.entity_type = p_type AND s.entity_id = k.entity_id AND s.source_id = k.source_id
          AND NOT EXISTS (
              SELECT 1 FROM wanted w WHERE w.entity_id = s.entity_id AND w.source_id = s.source_id
          )
    )
    INSERT INTO source_items AS s (source_id, entity_type, kind, entity_id, sort_ts, grants)
    SELECT source_id, p_type, kind, entity_id, sort_ts, grants FROM wanted
    ON CONFLICT (entity_type, entity_id, source_id) DO UPDATE
    SET kind = EXCLUDED.kind, sort_ts = EXCLUDED.sort_ts, grants = EXCLUDED.grants
    WHERE (s.kind, s.sort_ts, s.grants)
          IS DISTINCT FROM (EXCLUDED.kind, EXCLUDED.sort_ts, EXCLUDED.grants)
$$;

-- Rewrites the sort keys of p_ids' rows, for saves, which change neither grants nor kind. Callers
-- hold the items' buckets and call this in a statement of its own.
CREATE FUNCTION source_items_restate(p_type text, p_ids text[]) RETURNS void
LANGUAGE sql AS $$
    UPDATE source_items s
    SET sort_ts = i.sort_ts
    FROM source_items_state(p_type, p_ids) i
    WHERE s.entity_type = p_type AND s.entity_id = i.entity_id
      AND s.sort_ts IS DISTINCT FROM i.sort_ts
$$;

-- Locks the buckets of the (p_types[i], p_ids[i]) items, in bucket order, until commit. A bucket
-- row another transaction is still creating makes this wait for it, as a held lock would.
CREATE FUNCTION source_items_lock(p_types text[], p_ids text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    buckets int[];
BEGIN
    buckets := ARRAY(
        SELECT DISTINCT source_items_bucket(k.t, k.i)
        FROM unnest(p_types, p_ids) AS k(t, i)
        WHERE k.i IS NOT NULL
        ORDER BY 1
    );
    INSERT INTO source_items_mutex
    SELECT b FROM unnest(buckets) b ORDER BY b
    ON CONFLICT DO NOTHING;
    PERFORM 1 FROM source_items_mutex WHERE bucket = ANY (buckets) ORDER BY bucket FOR UPDATE;
END $$;

-- Locks and rewrites every row of p_ids. The backfill calls this for every item.
CREATE FUNCTION source_items_refresh(p_type text, p_ids text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM source_items_require_read_committed();
    PERFORM source_items_lock(array_fill(p_type, ARRAY[cardinality(p_ids)]), p_ids);
    PERFORM source_items_rebuild(p_type, p_ids);
END $$;

-- Rewrites the rows of everything this transaction recorded. Runs once per transaction, at commit,
-- from the deferred trigger on pg_temp.source_items_commit.
CREATE FUNCTION source_items_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    entity text;
    ids text[];
    sources text[];
BEGIN
    PERFORM source_items_require_read_committed();
    PERFORM source_items_lock(
        ARRAY(SELECT entity_type FROM pg_temp.source_items_pending),
        ARRAY(SELECT entity_id FROM pg_temp.source_items_pending)
    );
    -- Every statement from here reads what the previous holders of these buckets committed. A
    -- truncation needs no bucket: until this transaction commits, its ACCESS EXCLUSIVE lock on the
    -- truncated table holds back every other rewrite, since each reads that table.
    FOR entity IN
        SELECT DISTINCT entity_type FROM pg_temp.source_items_pending WHERE change = 'truncate'
    LOOP
        IF entity = 'entity_access' THEN
            DELETE FROM source_items;
        ELSIF entity = 'document_sub_type' THEN
            UPDATE source_items SET kind = 'document' WHERE kind = 'task';
        ELSE
            DELETE FROM source_items WHERE entity_type = entity;
        END IF;
    END LOOP;
    FOREACH entity IN ARRAY ARRAY['chat', 'document', 'project'] LOOP
        ids := ARRAY(
            SELECT DISTINCT entity_id FROM pg_temp.source_items_pending
            WHERE change = 'item' AND entity_type = entity
        );
        IF cardinality(ids) > 0 THEN
            PERFORM source_items_rebuild(entity, ids);
        END IF;
        SELECT coalesce(array_agg(k.entity_id), '{}'), coalesce(array_agg(k.source_id), '{}')
        INTO ids, sources
        FROM (
            SELECT DISTINCT p.entity_id, p.source_id FROM pg_temp.source_items_pending p
            WHERE p.change = 'grant' AND p.entity_type = entity
              AND NOT EXISTS (
                  SELECT 1 FROM pg_temp.source_items_pending q
                  WHERE q.change = 'item' AND q.entity_type = entity AND q.entity_id = p.entity_id
              )
        ) k;
        IF cardinality(ids) > 0 THEN
            PERFORM source_items_rebuild_sources(entity, ids, sources);
        END IF;
        ids := ARRAY(
            SELECT DISTINCT p.entity_id FROM pg_temp.source_items_pending p
            WHERE p.change = 'state' AND p.entity_type = entity
              AND NOT EXISTS (
                  SELECT 1 FROM pg_temp.source_items_pending q
                  WHERE q.change = 'item' AND q.entity_type = entity AND q.entity_id = p.entity_id
              )
        );
        IF cardinality(ids) > 0 THEN
            PERFORM source_items_restate(entity, ids);
        END IF;
    END LOOP;
    DELETE FROM pg_temp.source_items_pending;
    DELETE FROM pg_temp.source_items_commit;
    PERFORM set_config('source_items.pending', '', true);
    RETURN NULL;
END $$;

-- Readies this session's record of changes and schedules source_items_apply for this transaction's
-- commit. Statement triggers call it, then insert into pg_temp.source_items_pending.
CREATE FUNCTION source_items_prepare() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM source_items_require_read_committed();
    IF to_regclass('pg_temp.source_items_pending') IS NULL THEN
        -- change: 'item' rewrites the item's rows, 'grant' one (item, source) row, 'state' the
        -- item's sort keys, 'truncate' every row of the input table named in entity_type.
        CREATE TEMPORARY TABLE source_items_pending (
            change text NOT NULL,
            entity_type text NOT NULL,
            entity_id text,
            source_id text
        ) ON COMMIT DELETE ROWS;
        CREATE TEMPORARY TABLE source_items_commit (scheduled boolean) ON COMMIT DELETE ROWS;
        CREATE CONSTRAINT TRIGGER source_items_apply AFTER INSERT ON pg_temp.source_items_commit
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION source_items_apply();
        ALTER TABLE pg_temp.source_items_commit ENABLE ALWAYS TRIGGER source_items_apply;
    END IF;
    IF coalesce(current_setting('source_items.pending', true), '') = '' THEN
        INSERT INTO pg_temp.source_items_commit VALUES (true);
        PERFORM set_config('source_items.pending', 'scheduled', true);
    END IF;
END $$;

-- Grant changes, once per statement. Old and new grants are compared as multisets of (item, source)
-- rather than paired by id, so access-level changes record nothing and a statement that also
-- rewrites grant ids is still seen.
CREATE FUNCTION source_items_grants_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM source_items_prepare();
    IF TG_OP = 'INSERT' THEN
        INSERT INTO pg_temp.source_items_pending
        SELECT 'grant', entity_type, entity_id::text, source_id FROM new_rows
        WHERE entity_type IN ('document', 'chat', 'project');
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO pg_temp.source_items_pending
        SELECT 'grant', entity_type, entity_id::text, source_id FROM old_rows
        WHERE entity_type IN ('document', 'chat', 'project');
    ELSE
        INSERT INTO pg_temp.source_items_pending
        SELECT 'grant', k.entity_type, k.entity_id::text, k.source_id
        FROM (
            (SELECT entity_type, entity_id, source_id FROM new_rows
             EXCEPT ALL
             SELECT entity_type, entity_id, source_id FROM old_rows)
            UNION ALL
            (SELECT entity_type, entity_id, source_id FROM old_rows
             EXCEPT ALL
             SELECT entity_type, entity_id, source_id FROM new_rows)
        ) k
        WHERE k.entity_type IN ('document', 'chat', 'project');
    END IF;
    RETURN NULL;
END $$;

-- TG_ARGV[0] is the entity_type the table's rows have in entity_access. Inserts and deletes rewrite
-- the item's rows.
CREATE FUNCTION source_items_items_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM source_items_prepare();
    IF TG_OP = 'INSERT' THEN
        INSERT INTO pg_temp.source_items_pending
        SELECT 'item', TG_ARGV[0], id, NULL FROM new_rows;
    ELSE
        INSERT INTO pg_temp.source_items_pending
        SELECT 'item', TG_ARGV[0], id, NULL FROM old_rows;
    END IF;
    RETURN NULL;
END $$;

-- A save changes the item's sort key; a changed id removes the old id and adds the new one.
CREATE FUNCTION source_items_item_updated() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM source_items_prepare();
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        INSERT INTO pg_temp.source_items_pending
        VALUES ('item', TG_ARGV[0], OLD.id, NULL), ('item', TG_ARGV[0], NEW.id, NULL);
    ELSE
        INSERT INTO pg_temp.source_items_pending VALUES ('state', TG_ARGV[0], NEW.id, NULL);
    END IF;
    RETURN NULL;
END $$;

CREATE FUNCTION source_items_sub_type_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM source_items_prepare();
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        INSERT INTO pg_temp.source_items_pending
        SELECT 'item', 'document', document_id, NULL FROM new_rows;
    END IF;
    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        INSERT INTO pg_temp.source_items_pending
        SELECT 'item', 'document', document_id, NULL FROM old_rows;
    END IF;
    RETURN NULL;
END $$;

-- TG_ARGV[0] names the truncated table.
CREATE FUNCTION source_items_truncated() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM source_items_prepare();
    INSERT INTO pg_temp.source_items_pending VALUES ('truncate', TG_ARGV[0], NULL, NULL);
    RETURN NULL;
END $$;

CREATE TRIGGER source_items_grants_inserted AFTER INSERT ON entity_access
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_grants_changed();
CREATE TRIGGER source_items_grants_deleted AFTER DELETE ON entity_access
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_grants_changed();
CREATE TRIGGER source_items_grants_updated AFTER UPDATE ON entity_access
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_grants_changed();
CREATE TRIGGER source_items_truncated AFTER TRUNCATE ON entity_access
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_truncated('entity_access');

CREATE TRIGGER source_items_sub_type_inserted AFTER INSERT ON document_sub_type
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_sub_type_changed();
CREATE TRIGGER source_items_sub_type_deleted AFTER DELETE ON document_sub_type
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_sub_type_changed();
CREATE TRIGGER source_items_sub_type_updated AFTER UPDATE ON document_sub_type
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_sub_type_changed();
CREATE TRIGGER source_items_truncated AFTER TRUNCATE ON document_sub_type
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_truncated('document_sub_type');

CREATE TRIGGER source_items_inserted AFTER INSERT ON "Document"
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_changed('document');
CREATE TRIGGER source_items_deleted AFTER DELETE ON "Document"
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_changed('document');
CREATE TRIGGER source_items_updated AFTER UPDATE ON "Document"
    FOR EACH ROW
    WHEN (OLD.id IS DISTINCT FROM NEW.id
          OR (CASE WHEN OLD."deletedAt" IS NULL THEN OLD."updatedAt" END)
             IS DISTINCT FROM (CASE WHEN NEW."deletedAt" IS NULL THEN NEW."updatedAt" END))
    EXECUTE FUNCTION source_items_item_updated('document');
CREATE TRIGGER source_items_truncated AFTER TRUNCATE ON "Document"
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_truncated('document');

CREATE TRIGGER source_items_inserted AFTER INSERT ON "Chat"
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_changed('chat');
CREATE TRIGGER source_items_deleted AFTER DELETE ON "Chat"
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_changed('chat');
CREATE TRIGGER source_items_updated AFTER UPDATE ON "Chat"
    FOR EACH ROW
    WHEN (OLD.id IS DISTINCT FROM NEW.id
          OR (CASE WHEN OLD."deletedAt" IS NULL THEN OLD."updatedAt" END)
             IS DISTINCT FROM (CASE WHEN NEW."deletedAt" IS NULL THEN NEW."updatedAt" END))
    EXECUTE FUNCTION source_items_item_updated('chat');
CREATE TRIGGER source_items_truncated AFTER TRUNCATE ON "Chat"
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_truncated('chat');

CREATE TRIGGER source_items_inserted AFTER INSERT ON "Project"
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_changed('project');
CREATE TRIGGER source_items_deleted AFTER DELETE ON "Project"
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_changed('project');
CREATE TRIGGER source_items_updated AFTER UPDATE ON "Project"
    FOR EACH ROW
    WHEN (OLD.id IS DISTINCT FROM NEW.id
          OR (CASE WHEN OLD."deletedAt" IS NULL THEN OLD."updatedAt" END)
             IS DISTINCT FROM (CASE WHEN NEW."deletedAt" IS NULL THEN NEW."updatedAt" END))
    EXECUTE FUNCTION source_items_item_updated('project');
CREATE TRIGGER source_items_truncated AFTER TRUNCATE ON "Project"
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_truncated('project');

-- Fire in replica mode too, so fixtures and scripts that skip foreign-key checks keep the
-- projection current.
ALTER TABLE entity_access ENABLE ALWAYS TRIGGER source_items_grants_inserted;
ALTER TABLE entity_access ENABLE ALWAYS TRIGGER source_items_grants_deleted;
ALTER TABLE entity_access ENABLE ALWAYS TRIGGER source_items_grants_updated;
ALTER TABLE entity_access ENABLE ALWAYS TRIGGER source_items_truncated;
ALTER TABLE document_sub_type ENABLE ALWAYS TRIGGER source_items_sub_type_inserted;
ALTER TABLE document_sub_type ENABLE ALWAYS TRIGGER source_items_sub_type_deleted;
ALTER TABLE document_sub_type ENABLE ALWAYS TRIGGER source_items_sub_type_updated;
ALTER TABLE document_sub_type ENABLE ALWAYS TRIGGER source_items_truncated;
ALTER TABLE "Document" ENABLE ALWAYS TRIGGER source_items_inserted;
ALTER TABLE "Document" ENABLE ALWAYS TRIGGER source_items_deleted;
ALTER TABLE "Document" ENABLE ALWAYS TRIGGER source_items_updated;
ALTER TABLE "Document" ENABLE ALWAYS TRIGGER source_items_truncated;
ALTER TABLE "Chat" ENABLE ALWAYS TRIGGER source_items_inserted;
ALTER TABLE "Chat" ENABLE ALWAYS TRIGGER source_items_deleted;
ALTER TABLE "Chat" ENABLE ALWAYS TRIGGER source_items_updated;
ALTER TABLE "Chat" ENABLE ALWAYS TRIGGER source_items_truncated;
ALTER TABLE "Project" ENABLE ALWAYS TRIGGER source_items_inserted;
ALTER TABLE "Project" ENABLE ALWAYS TRIGGER source_items_deleted;
ALTER TABLE "Project" ENABLE ALWAYS TRIGGER source_items_updated;
ALTER TABLE "Project" ENABLE ALWAYS TRIGGER source_items_truncated;
