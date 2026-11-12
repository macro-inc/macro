SET LOCAL lock_timeout = '2s';

DROP INDEX password_item_entities_folder_idx;
DROP INDEX password_folders_parent_idx;
ALTER TABLE password_folders DROP CONSTRAINT password_folders_parent_fk;
ALTER TABLE password_folders DROP CONSTRAINT password_folders_not_own_parent;
ALTER TABLE password_folders DROP COLUMN parent_id;
