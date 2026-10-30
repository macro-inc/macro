-- One row per (source, item) for every document, chat and project a source can see, so soup can
-- read a principal's items newest first from one index. Access lives in entity_access and the sort
-- key on each item table, and no index can cover both.
--
-- `grants` counts the entity_access rows behind a row. `sort_ts` is the item's "updatedAt", or
-- NULL while the item is soft-deleted, so readers filter on `sort_ts IS NOT NULL`. `kind` splits
-- tasks from other documents.
--
-- Triggers keep the table equal to what entity_access, the item tables and document_sub_type say,
-- for every writer: application code, foreign-key cascades, scripts and fixtures loaded in replica
-- mode alike. crates/source_items holds the backfill, the audit and the tests.
--
-- Concurrency, under READ COMMITTED (the triggers refuse other isolation levels, which could not
-- see what an earlier lock holder committed):
--   * Every change locks the item before its rows are rewritten, and rewrites them in a later
--     statement, so the rewrite reads what the previous lock holder committed. Saves and deletes
--     already hold the item's row lock; grant and subtype changes take it in the mode a save takes
--     (FOR NO KEY UPDATE), in id order, so foreign-key checks are not blocked.
--   * A grant change cannot lock an item whose insert has not committed. An insert therefore holds
--     its items' advisory keys (shared) and the grants it counted (FOR SHARE) until commit. A grant
--     removed or moved away waits on those row locks; a grant added for an item it cannot see waits
--     on the keys, then looks again. Keys come in three classes, so that no transaction holds more than
--     about 5,000 of them: one per item for a transaction's first 4,096 items, then 1,024 buckets
--     for a large insert; a grant change that cannot see more than 4,096 items takes one global
--     key, which every insert holds shared.
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

CREATE FUNCTION source_items_require_read_committed() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'changes to source_items inputs require READ COMMITTED isolation'
            USING ERRCODE = 'invalid_transaction_state';
    END IF;
END $$;

-- Holds the advisory keys that pair an item insert with a grant change on the same item. Inserts
-- take them shared, so concurrent inserts never wait on each other; a grant change takes them
-- exclusively. 'source_items.keys' counts the per-item and bucket keys this transaction holds.
CREATE FUNCTION source_items_take_keys(p_type text, p_ids text[], p_exclusive boolean)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    held int := coalesce(nullif(current_setting('source_items.keys', true), ''), '0')::int;
    -- Tests lower the limit to reach the bucket and global keys with few items.
    key_limit int := coalesce(nullif(current_setting('source_items.key_limit', true), ''), '4096')::int;
    n int := cardinality(p_ids);
BEGIN
    IF n = 0 THEN
        RETURN;
    END IF;
    IF p_exclusive THEN
        IF held + n > key_limit THEN
            PERFORM pg_advisory_xact_lock(1397900103, 0);
            RETURN;
        END IF;
        PERFORM pg_advisory_xact_lock(1397900105, k)
        FROM (SELECT DISTINCT hashtext(p_type || ':' || id) AS k FROM unnest(p_ids) id ORDER BY 1) x;
        PERFORM pg_advisory_xact_lock(1397900098, k)
        FROM (SELECT DISTINCT hashtext(p_type || ':' || id) & 1023 AS k FROM unnest(p_ids) id ORDER BY 1) x;
    ELSE
        PERFORM pg_advisory_xact_lock_shared(1397900103, 0);
        IF held + n > key_limit THEN
            PERFORM pg_advisory_xact_lock_shared(1397900098, k)
            FROM (SELECT DISTINCT hashtext(p_type || ':' || id) & 1023 AS k FROM unnest(p_ids) id ORDER BY 1) x;
            RETURN;
        END IF;
        PERFORM pg_advisory_xact_lock_shared(1397900105, k)
        FROM (SELECT DISTINCT hashtext(p_type || ':' || id) AS k FROM unnest(p_ids) id ORDER BY 1) x;
    END IF;
    PERFORM set_config('source_items.keys', (held + n)::text, true);
END $$;

-- Locks the visible rows of p_ids in id order and returns the ids without one.
CREATE FUNCTION source_items_lock_rows(p_type text, p_ids text[]) RETURNS text[]
LANGUAGE plpgsql AS $$
DECLARE
    locked text[];
BEGIN
    IF p_type = 'document' THEN
        SELECT coalesce(array_agg(id), '{}') INTO locked
        FROM (SELECT id FROM "Document" WHERE id = ANY (p_ids) ORDER BY id FOR NO KEY UPDATE) l;
    ELSIF p_type = 'chat' THEN
        SELECT coalesce(array_agg(id), '{}') INTO locked
        FROM (SELECT id FROM "Chat" WHERE id = ANY (p_ids) ORDER BY id FOR NO KEY UPDATE) l;
    ELSE
        SELECT coalesce(array_agg(id), '{}') INTO locked
        FROM (SELECT id FROM "Project" WHERE id = ANY (p_ids) ORDER BY id FOR NO KEY UPDATE) l;
    END IF;
    RETURN ARRAY(SELECT unnest(p_ids) EXCEPT SELECT unnest(locked));
END $$;

-- Locks the items whose rows a change rewrites. p_added names the items the change may give rows
-- to; for those without a visible row it waits out any insert in flight and locks what committed.
CREATE FUNCTION source_items_lock(p_type text, p_ids text[], p_added text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    unseen text[];
BEGIN
    unseen := ARRAY(
        SELECT unnest(source_items_lock_rows(p_type, p_ids)) INTERSECT SELECT unnest(p_added)
    );
    IF cardinality(unseen) > 0 THEN
        PERFORM source_items_take_keys(p_type, unseen, true);
        -- A new statement, so it sees inserts that committed while the keys were awaited.
        PERFORM source_items_lock_rows(p_type, unseen);
    END IF;
END $$;

-- Rewrites the rows of p_ids from entity_access and the item tables. Callers lock the items first
-- and call this in a statement of its own.
CREATE FUNCTION source_items_rebuild(p_type text, p_ids text[]) RETURNS void
LANGUAGE sql AS $$
    WITH items AS (
        SELECT d.id,
               CASE WHEN st.sub_type = 'task' THEN 'task' ELSE 'document' END AS kind,
               CASE WHEN d."deletedAt" IS NULL THEN d."updatedAt" END AS sort_ts
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
    ), wanted AS (
        SELECT ea.source_id, i.id AS entity_id, i.kind, i.sort_ts, count(*)::int AS grants
        FROM items i
        JOIN entity_access ea ON ea.entity_id::text = i.id AND ea.entity_type = p_type
        GROUP BY ea.source_id, i.id, i.kind, i.sort_ts
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

-- Locks and rewrites the rows of p_ids. The backfill calls this for every item.
CREATE FUNCTION source_items_refresh(p_type text, p_ids text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM source_items_require_read_committed();
    PERFORM source_items_lock(p_type, p_ids, p_ids);
    PERFORM source_items_rebuild(p_type, p_ids);
END $$;

-- Grant changes, once per statement. Only rows whose (entity, source) changed matter: access-level
-- changes leave the projection alone. Types are processed in a fixed order, items in id order.
CREATE FUNCTION source_items_grants_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    added text[];
    removed text[];
    touched text[];
    entity text;
BEGIN
    PERFORM source_items_require_read_committed();
    FOREACH entity IN ARRAY ARRAY['chat', 'document', 'project'] LOOP
        IF TG_OP = 'INSERT' THEN
            added := ARRAY(SELECT DISTINCT entity_id::text FROM new_rows WHERE entity_type = entity);
            removed := '{}';
        ELSIF TG_OP = 'DELETE' THEN
            added := '{}';
            removed := ARRAY(SELECT DISTINCT entity_id::text FROM old_rows WHERE entity_type = entity);
        ELSE
            added := ARRAY(
                SELECT DISTINCT n.entity_id::text
                FROM new_rows n JOIN old_rows o USING (id)
                WHERE n.entity_type = entity
                  AND (o.entity_id, o.entity_type, o.source_id)
                      IS DISTINCT FROM (n.entity_id, n.entity_type, n.source_id)
            );
            removed := ARRAY(
                SELECT DISTINCT o.entity_id::text
                FROM old_rows o JOIN new_rows n USING (id)
                WHERE o.entity_type = entity
                  AND (o.entity_id, o.entity_type, o.source_id)
                      IS DISTINCT FROM (n.entity_id, n.entity_type, n.source_id)
            );
        END IF;
        CONTINUE WHEN cardinality(added) = 0 AND cardinality(removed) = 0;
        touched := ARRAY(SELECT unnest(added) UNION SELECT unnest(removed));
        PERFORM source_items_lock(entity, touched, added);
        PERFORM source_items_rebuild(entity, touched);
    END LOOP;
    RETURN NULL;
END $$;

-- TG_ARGV[0] is the entity_type the table's rows have in entity_access.
CREATE FUNCTION source_items_items_inserted() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    ids text[];
BEGIN
    PERFORM source_items_require_read_committed();
    ids := ARRAY(SELECT id FROM new_rows ORDER BY id);
    PERFORM source_items_take_keys(TG_ARGV[0], ids, false);
    -- A grant removed or moved while this insert is in flight waits for it on these row locks.
    -- FOR SHARE, not FOR KEY SHARE: entity_access's unique indexes are partial, so moving a grant
    -- to another item or source is not a key update.
    PERFORM 1 FROM entity_access
    WHERE entity_type = TG_ARGV[0] AND entity_id::text = ANY (ids)
    FOR SHARE;
    PERFORM source_items_rebuild(TG_ARGV[0], ids);
    RETURN NULL;
END $$;

CREATE FUNCTION source_items_items_deleted() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM source_items_require_read_committed();
    DELETE FROM source_items s
    USING old_rows o
    WHERE s.entity_type = TG_ARGV[0] AND s.entity_id = o.id;
    RETURN NULL;
END $$;

-- Saves already hold the item's row lock, so the item's rows are current here. A changed id is a
-- removal of the old id and an insert of the new one.
CREATE FUNCTION source_items_item_updated() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM source_items_require_read_committed();
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        DELETE FROM source_items WHERE entity_type = TG_ARGV[0] AND entity_id = OLD.id;
        PERFORM source_items_take_keys(TG_ARGV[0], ARRAY[NEW.id], false);
        PERFORM 1 FROM entity_access
        WHERE entity_type = TG_ARGV[0] AND entity_id::text = NEW.id
        FOR SHARE;
        PERFORM source_items_rebuild(TG_ARGV[0], ARRAY[NEW.id]);
    ELSE
        UPDATE source_items
        SET sort_ts = CASE WHEN NEW."deletedAt" IS NULL THEN NEW."updatedAt" END
        WHERE entity_type = TG_ARGV[0] AND entity_id = NEW.id;
    END IF;
    RETURN NULL;
END $$;

CREATE FUNCTION source_items_sub_type_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    ids text[];
BEGIN
    PERFORM source_items_require_read_committed();
    IF TG_OP = 'INSERT' THEN
        ids := ARRAY(SELECT document_id FROM new_rows);
    ELSIF TG_OP = 'DELETE' THEN
        ids := ARRAY(SELECT document_id FROM old_rows);
    ELSE
        ids := ARRAY(
            SELECT o.document_id FROM old_rows o
            UNION
            SELECT n.document_id FROM new_rows n
        );
    END IF;
    PERFORM source_items_lock('document', ids, ids);
    PERFORM source_items_rebuild('document', ids);
    RETURN NULL;
END $$;

-- TG_ARGV[0] names the truncated table.
CREATE FUNCTION source_items_truncated() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_ARGV[0] = 'entity_access' THEN
        DELETE FROM source_items;
    ELSIF TG_ARGV[0] = 'document_sub_type' THEN
        UPDATE source_items SET kind = 'document' WHERE kind = 'task';
    ELSE
        DELETE FROM source_items WHERE entity_type = TG_ARGV[0];
    END IF;
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
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_inserted('document');
CREATE TRIGGER source_items_deleted AFTER DELETE ON "Document"
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_deleted('document');
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
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_inserted('chat');
CREATE TRIGGER source_items_deleted AFTER DELETE ON "Chat"
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_deleted('chat');
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
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_inserted('project');
CREATE TRIGGER source_items_deleted AFTER DELETE ON "Project"
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_deleted('project');
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
