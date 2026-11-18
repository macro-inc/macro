-- Databases can be filed into a folder, like documents, chats and email
-- threads. Purging the folder returns them to the root.
ALTER TABLE database_entities ADD COLUMN project_id TEXT
    REFERENCES "Project"(id) ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX database_entities_project_id_idx ON database_entities (project_id);
