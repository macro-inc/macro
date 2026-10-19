-- Historical transfers can outlive their source after disconnect.
-- NOT VALID retains them while enforcing referential integrity for new operations.
ALTER TABLE email_draft_transfers
    ADD CONSTRAINT email_draft_transfers_source_id_fkey FOREIGN KEY(source_id) REFERENCES email_messages(id) ON DELETE CASCADE NOT VALID,
    ADD CONSTRAINT email_draft_transfers_source_link_id_fkey FOREIGN KEY(source_link_id) REFERENCES email_links(id) ON DELETE CASCADE NOT VALID;
