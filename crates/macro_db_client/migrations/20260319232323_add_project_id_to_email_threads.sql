ALTER TABLE email_threads ADD COLUMN project_id text;

ALTER TABLE email_threads
    ADD CONSTRAINT email_threads_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES "Project"(id)
    ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX idx_email_threads_project_id ON email_threads USING btree (project_id);
