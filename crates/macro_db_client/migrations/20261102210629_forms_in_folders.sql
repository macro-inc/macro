-- Forms can be filed into a folder, like databases. Purging the folder
-- returns them to the root.
ALTER TABLE forms ADD COLUMN project_id TEXT
    REFERENCES "Project"(id) ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX forms_project_id_idx ON forms (project_id);
