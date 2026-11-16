SET LOCAL lock_timeout = '2s';

-- These metadata tables are introduced by the same unshipped feature. Preserve
-- existing preview rows: the nullable parent makes every existing folder a root.
ALTER TABLE password_folders ADD COLUMN parent_id UUID;
ALTER TABLE password_folders ADD CONSTRAINT password_folders_not_own_parent
    CHECK (parent_id IS DISTINCT FROM id);
ALTER TABLE password_folders ADD CONSTRAINT password_folders_parent_fk
    FOREIGN KEY (team_id,parent_id) REFERENCES password_folders(team_id,id);
CREATE INDEX password_folders_parent_idx ON password_folders(team_id,parent_id);
CREATE INDEX password_item_entities_folder_idx
    ON password_item_entities(team_id,(metadata->>'folderId'))
    WHERE metadata->>'folderId' IS NOT NULL;
