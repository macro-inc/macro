-- One row per (source, item) for every document, chat and project a source can see, so soup can
-- read a principal's items newest first from one index. Access lives in entity_access and the sort
-- key on each item table, and no index can cover both.
--
-- `grants` counts the entity_access rows behind a row, so direct and project-inherited grants from
-- one source share a row that goes away with its last grant. `sort_ts` is the item's "updatedAt",
-- or NULL while the item is soft-deleted, so a restore needs no grant lookup; readers filter on
-- `sort_ts IS NOT NULL`. `kind` splits tasks from other documents.
--
-- Every trigger locks an item before it reads or writes the item's rows, and reads in a later
-- statement, so under READ COMMITTED the read sees whatever the previous lock holder committed.
-- Writers to these tables must therefore use READ COMMITTED, as team_share::acquire_guard requires.
--   * Saves and deletes already hold the item's row lock.
--   * Grant and sub-type changes take the row lock in the mode a save takes. An item with no
--     visible row may be mid-insert, so they then wait on the advisory lock item inserts take and
--     try the row lock again.
--   * Item inserts take the advisory lock, so a grant written while the insert is in flight is
--     counted once: by the insert's resync if the grant committed first, else by its own delta.
-- Grant statements and inserts lock their items in (entity_type, entity_id) order.
-- Not handled: changing an item's id (entity_access does not follow it either).

SET LOCAL lock_timeout = '5s';

CREATE TABLE source_items (
    source_id   text NOT NULL,
    entity_type text NOT NULL CHECK (entity_type IN ('document', 'chat', 'project')),
    kind        text NOT NULL CHECK (kind IN ('document', 'task', 'chat', 'project')),
    entity_id   text NOT NULL,
    sort_ts     timestamp(3),
    grants      int  NOT NULL,
    PRIMARY KEY (entity_type, entity_id, source_id)
);

-- Feed state of whichever of p_ids exist. A SQL function so callers can inline it.
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

-- FOR NO KEY UPDATE is the mode a save takes, so a later save in the same transaction needs no
-- upgrade and foreign key checks are not blocked. Returns whether a row was visible.
CREATE FUNCTION source_items_lock_row(p_type text, p_id text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
    IF p_type = 'document' THEN
        PERFORM 1 FROM "Document" WHERE id = p_id FOR NO KEY UPDATE;
    ELSIF p_type = 'chat' THEN
        PERFORM 1 FROM "Chat" WHERE id = p_id FOR NO KEY UPDATE;
    ELSE
        PERFORM 1 FROM "Project" WHERE id = p_id FOR NO KEY UPDATE;
    END IF;
    RETURN FOUND;
END $$;

CREATE FUNCTION source_items_lock_insert(p_type text, p_id text) RETURNS void
LANGUAGE sql AS $$
    SELECT pg_advisory_xact_lock(hashtextextended(p_type || ':' || p_id, 7316));
$$;

CREATE FUNCTION source_items_lock_item(p_type text, p_id text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT source_items_lock_row(p_type, p_id) THEN
        PERFORM source_items_lock_insert(p_type, p_id);
        -- A new statement, so it sees an insert that committed while this one waited.
        PERFORM source_items_lock_row(p_type, p_id);
    END IF;
END $$;

-- Rewrites the rows of p_ids from entity_access and the item rows. Callers lock the items first.
CREATE FUNCTION source_items_resync(p_type text, p_ids text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    WITH want AS (
        SELECT ea.source_id, it.entity_id, it.kind, it.sort_ts, count(*)::int AS grants
        FROM source_items_state(p_type, p_ids) it
        JOIN entity_access ea ON ea.entity_id::text = it.entity_id AND ea.entity_type = p_type
        GROUP BY ea.source_id, it.entity_id, it.kind, it.sort_ts
    ), stale AS (
        DELETE FROM source_items s
        WHERE s.entity_type = p_type AND s.entity_id = ANY (p_ids)
          AND NOT EXISTS (
              SELECT 1 FROM want w WHERE w.entity_id = s.entity_id AND w.source_id = s.source_id)
    )
    INSERT INTO source_items AS s (source_id, entity_type, kind, entity_id, sort_ts, grants)
    SELECT w.source_id, p_type, w.kind, w.entity_id, w.sort_ts, w.grants FROM want w
    ON CONFLICT (entity_type, entity_id, source_id) DO UPDATE
    SET kind = EXCLUDED.kind, sort_ts = EXCLUDED.sort_ts, grants = EXCLUDED.grants
    WHERE (s.kind, s.sort_ts, s.grants)
          IS DISTINCT FROM (EXCLUDED.kind, EXCLUDED.sort_ts, EXCLUDED.grants);
END $$;

-- Grant triggers run once per statement, so sharing a project applies one set-based delta.
-- Transition tables are only visible to the function they are passed to, hence three functions.
CREATE FUNCTION source_items_grant_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT DISTINCT entity_type, entity_id::text AS entity_id FROM new_rows
             WHERE entity_type IN ('document', 'chat', 'project') ORDER BY 1, 2 LOOP
        PERFORM source_items_lock_item(r.entity_type, r.entity_id);
    END LOOP;
    INSERT INTO source_items AS s (source_id, entity_type, kind, entity_id, sort_ts, grants)
    SELECT g.source_id, g.entity_type, it.kind, g.entity_id, it.sort_ts, g.n
    FROM (SELECT entity_type, entity_id::text AS entity_id, source_id, count(*)::int AS n
          FROM new_rows WHERE entity_type IN ('document', 'chat', 'project')
          GROUP BY 1, 2, 3) g
    CROSS JOIN LATERAL source_items_state(g.entity_type, ARRAY[g.entity_id]) it
    ON CONFLICT (entity_type, entity_id, source_id) DO UPDATE SET grants = s.grants + EXCLUDED.grants;
    RETURN NULL;
END $$;

CREATE FUNCTION source_items_grant_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT DISTINCT entity_type, entity_id::text AS entity_id FROM old_rows
             WHERE entity_type IN ('document', 'chat', 'project') ORDER BY 1, 2 LOOP
        PERFORM source_items_lock_item(r.entity_type, r.entity_id);
    END LOOP;
    WITH g AS (
        SELECT entity_type, entity_id::text AS entity_id, source_id, count(*)::int AS n
        FROM old_rows WHERE entity_type IN ('document', 'chat', 'project')
        GROUP BY 1, 2, 3
    ), gone AS (
        DELETE FROM source_items s USING g
        WHERE s.entity_type = g.entity_type AND s.entity_id = g.entity_id
          AND s.source_id = g.source_id AND s.grants <= g.n
    )
    UPDATE source_items s SET grants = s.grants - g.n FROM g
    WHERE s.entity_type = g.entity_type AND s.entity_id = g.entity_id
      AND s.source_id = g.source_id AND s.grants > g.n;
    RETURN NULL;
END $$;

-- Only rows whose (entity, source) changed matter; access level changes leave the feed alone. The
-- old side is removed before the new side is added, in separate statements, because one grant can
-- move onto a row another grant in the same statement moves off.
CREATE FUNCTION source_items_grant_update() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    FOR r IN WITH moved AS (
                 SELECT o.entity_type AS old_type, o.entity_id::text AS old_id,
                        n.entity_type AS new_type, n.entity_id::text AS new_id
                 FROM old_rows o JOIN new_rows n USING (id)
                 WHERE (o.entity_id, o.entity_type, o.source_id)
                       IS DISTINCT FROM (n.entity_id, n.entity_type, n.source_id))
             SELECT old_type AS entity_type, old_id AS entity_id FROM moved
             UNION
             SELECT new_type, new_id FROM moved
             ORDER BY 1, 2 LOOP
        CONTINUE WHEN r.entity_type NOT IN ('document', 'chat', 'project');
        PERFORM source_items_lock_item(r.entity_type, r.entity_id);
    END LOOP;
    WITH g AS (
        SELECT o.entity_type, o.entity_id::text AS entity_id, o.source_id, count(*)::int AS n
        FROM old_rows o JOIN new_rows n USING (id)
        WHERE (o.entity_id, o.entity_type, o.source_id)
              IS DISTINCT FROM (n.entity_id, n.entity_type, n.source_id)
          AND o.entity_type IN ('document', 'chat', 'project')
        GROUP BY 1, 2, 3
    ), gone AS (
        DELETE FROM source_items s USING g
        WHERE s.entity_type = g.entity_type AND s.entity_id = g.entity_id
          AND s.source_id = g.source_id AND s.grants <= g.n
    )
    UPDATE source_items s SET grants = s.grants - g.n FROM g
    WHERE s.entity_type = g.entity_type AND s.entity_id = g.entity_id
      AND s.source_id = g.source_id AND s.grants > g.n;
    INSERT INTO source_items AS s (source_id, entity_type, kind, entity_id, sort_ts, grants)
    SELECT g.source_id, g.entity_type, it.kind, g.entity_id, it.sort_ts, g.n
    FROM (SELECT n.entity_type, n.entity_id::text AS entity_id, n.source_id, count(*)::int AS n
          FROM old_rows o JOIN new_rows n USING (id)
          WHERE (o.entity_id, o.entity_type, o.source_id)
                IS DISTINCT FROM (n.entity_id, n.entity_type, n.source_id)
            AND n.entity_type IN ('document', 'chat', 'project')
          GROUP BY 1, 2, 3) g
    CROSS JOIN LATERAL source_items_state(g.entity_type, ARRAY[g.entity_id]) it
    ON CONFLICT (entity_type, entity_id, source_id) DO UPDATE SET grants = s.grants + EXCLUDED.grants;
    RETURN NULL;
END $$;

-- TG_ARGV[0] is the entity_type the table's rows have in entity_access. Inserts and deletes run
-- once per statement so a bulk insert locks its items in order, like a grant statement.
CREATE FUNCTION source_items_items_inserted() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    ids text[];
    item_id text;
BEGIN
    SELECT array_agg(n.id ORDER BY n.id) INTO ids FROM new_rows n;
    IF ids IS NULL THEN
        RETURN NULL;
    END IF;
    FOREACH item_id IN ARRAY ids LOOP
        PERFORM source_items_lock_insert(TG_ARGV[0], item_id);
    END LOOP;
    PERFORM source_items_resync(TG_ARGV[0], ids);
    RETURN NULL;
END $$;

CREATE FUNCTION source_items_items_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM source_items s USING old_rows o
    WHERE s.entity_type = TG_ARGV[0] AND s.entity_id = o.id;
    RETURN NULL;
END $$;

CREATE FUNCTION source_items_item_updated() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE source_items SET sort_ts = CASE WHEN NEW."deletedAt" IS NULL THEN NEW."updatedAt" END
    WHERE entity_type = TG_ARGV[0] AND entity_id = NEW.id;
    RETURN NULL;
END $$;

CREATE FUNCTION source_items_sub_type() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    doc text;
    new_kind text;
BEGIN
    FOR doc IN SELECT DISTINCT u.d FROM unnest(ARRAY[OLD.document_id, NEW.document_id]) u(d)
               WHERE u.d IS NOT NULL ORDER BY 1 LOOP
        PERFORM source_items_lock_item('document', doc);
        new_kind := CASE WHEN EXISTS (
                SELECT 1 FROM document_sub_type st WHERE st.document_id = doc AND st.sub_type = 'task'
            ) THEN 'task' ELSE 'document' END;
        UPDATE source_items SET kind = new_kind
        WHERE entity_type = 'document' AND entity_id = doc AND kind IS DISTINCT FROM new_kind;
    END LOOP;
    RETURN NULL;
END $$;

-- TG_ARGV[0] names the truncated table.
CREATE FUNCTION source_items_truncated() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE TRIGGER source_items_grant_insert AFTER INSERT ON entity_access
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_grant_insert();
CREATE TRIGGER source_items_grant_delete AFTER DELETE ON entity_access
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_grant_delete();
CREATE TRIGGER source_items_grant_update AFTER UPDATE ON entity_access
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_grant_update();
CREATE TRIGGER source_items_truncate AFTER TRUNCATE ON entity_access
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_truncated('entity_access');

CREATE TRIGGER source_items_insert AFTER INSERT ON "Document"
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_inserted('document');
CREATE TRIGGER source_items_delete AFTER DELETE ON "Document"
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_deleted('document');
CREATE TRIGGER source_items_update AFTER UPDATE OF "updatedAt", "deletedAt" ON "Document"
    FOR EACH ROW
    WHEN ((CASE WHEN OLD."deletedAt" IS NULL THEN OLD."updatedAt" END)
          IS DISTINCT FROM (CASE WHEN NEW."deletedAt" IS NULL THEN NEW."updatedAt" END))
    EXECUTE FUNCTION source_items_item_updated('document');
CREATE TRIGGER source_items_truncate AFTER TRUNCATE ON "Document"
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_truncated('document');

CREATE TRIGGER source_items_insert AFTER INSERT ON "Chat"
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_inserted('chat');
CREATE TRIGGER source_items_delete AFTER DELETE ON "Chat"
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_deleted('chat');
CREATE TRIGGER source_items_update AFTER UPDATE OF "updatedAt", "deletedAt" ON "Chat"
    FOR EACH ROW
    WHEN ((CASE WHEN OLD."deletedAt" IS NULL THEN OLD."updatedAt" END)
          IS DISTINCT FROM (CASE WHEN NEW."deletedAt" IS NULL THEN NEW."updatedAt" END))
    EXECUTE FUNCTION source_items_item_updated('chat');
CREATE TRIGGER source_items_truncate AFTER TRUNCATE ON "Chat"
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_truncated('chat');

CREATE TRIGGER source_items_insert AFTER INSERT ON "Project"
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_inserted('project');
CREATE TRIGGER source_items_delete AFTER DELETE ON "Project"
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_items_deleted('project');
CREATE TRIGGER source_items_update AFTER UPDATE OF "updatedAt", "deletedAt" ON "Project"
    FOR EACH ROW
    WHEN ((CASE WHEN OLD."deletedAt" IS NULL THEN OLD."updatedAt" END)
          IS DISTINCT FROM (CASE WHEN NEW."deletedAt" IS NULL THEN NEW."updatedAt" END))
    EXECUTE FUNCTION source_items_item_updated('project');
CREATE TRIGGER source_items_truncate AFTER TRUNCATE ON "Project"
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_truncated('project');

CREATE TRIGGER source_items_sub_type
    AFTER INSERT OR DELETE OR UPDATE OF document_id, sub_type ON document_sub_type
    FOR EACH ROW EXECUTE FUNCTION source_items_sub_type();
CREATE TRIGGER source_items_truncate AFTER TRUNCATE ON document_sub_type
    FOR EACH STATEMENT EXECUTE FUNCTION source_items_truncated('document_sub_type');
