-- The legacy comment importer allocates a mapping row and writes the message
-- it points at inside the same transaction, so these references hold at every
-- commit boundary. Deferred so the mapping can be inserted before the message.
ALTER TABLE migrated_comment_id
    ADD CONSTRAINT migrated_comment_id_message_id_fkey
        FOREIGN KEY (message_id) REFERENCES comms_messages (id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE migrated_comment_thread_id
    ADD CONSTRAINT migrated_comment_thread_id_root_id_fkey
        FOREIGN KEY (root_id) REFERENCES comms_message_threads (root_id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- The importer works one batch of documents at a time and the Document FK
-- cascades by document; neither had an index on the referencing column.
CREATE INDEX idx_migrated_comment_id_document
    ON migrated_comment_id (document_id);

CREATE INDEX idx_migrated_comment_thread_id_document
    ON migrated_comment_thread_id (document_id);
