ALTER TABLE contacts_backfill_outbox
    DROP CONSTRAINT contacts_backfill_outbox_comms_channel_id_fkey;

ALTER TABLE contacts_backfill_outbox
    ADD CONSTRAINT contacts_backfill_outbox_comms_channel_id_fkey
    FOREIGN KEY (comms_channel_id) REFERENCES comms_channels(id) ON DELETE CASCADE;
