SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS source_items_truncate ON document_sub_type;
DROP TRIGGER IF EXISTS source_items_sub_type ON document_sub_type;
DROP TRIGGER IF EXISTS source_items_truncate ON "Project";
DROP TRIGGER IF EXISTS source_items_update ON "Project";
DROP TRIGGER IF EXISTS source_items_delete ON "Project";
DROP TRIGGER IF EXISTS source_items_insert ON "Project";
DROP TRIGGER IF EXISTS source_items_truncate ON "Chat";
DROP TRIGGER IF EXISTS source_items_update ON "Chat";
DROP TRIGGER IF EXISTS source_items_delete ON "Chat";
DROP TRIGGER IF EXISTS source_items_insert ON "Chat";
DROP TRIGGER IF EXISTS source_items_truncate ON "Document";
DROP TRIGGER IF EXISTS source_items_update ON "Document";
DROP TRIGGER IF EXISTS source_items_delete ON "Document";
DROP TRIGGER IF EXISTS source_items_insert ON "Document";
DROP TRIGGER IF EXISTS source_items_truncate ON entity_access;
DROP TRIGGER IF EXISTS source_items_grant_update ON entity_access;
DROP TRIGGER IF EXISTS source_items_grant_delete ON entity_access;
DROP TRIGGER IF EXISTS source_items_grant_insert ON entity_access;

DROP FUNCTION IF EXISTS source_items_truncated();
DROP FUNCTION IF EXISTS source_items_sub_type();
DROP FUNCTION IF EXISTS source_items_item_updated();
DROP FUNCTION IF EXISTS source_items_items_deleted();
DROP FUNCTION IF EXISTS source_items_items_inserted();
DROP FUNCTION IF EXISTS source_items_grant_update();
DROP FUNCTION IF EXISTS source_items_grant_delete();
DROP FUNCTION IF EXISTS source_items_grant_insert();
DROP FUNCTION IF EXISTS source_items_resync(text, text[]);
DROP FUNCTION IF EXISTS source_items_lock_item(text, text);
DROP FUNCTION IF EXISTS source_items_lock_insert(text, text);
DROP FUNCTION IF EXISTS source_items_lock_row(text, text);
DROP FUNCTION IF EXISTS source_items_state(text, text[]);

DROP TABLE IF EXISTS source_items;
