CREATE TABLE contacts_backfill_outbox (
    id                SERIAL PRIMARY KEY,
    comms_channel_id  uuid        NOT NULL REFERENCES comms_channels(id),
    user_ids          jsonb       NOT NULL,
    applied_at        timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contacts_backfill_outbox_applied_at ON contacts_backfill_outbox(applied_at);

DO $$
DECLARE
    batch_size  INT := 100;
    last_id     TEXT := '00000000-0000-0000-0000-000000000000';
    batch_count INT;
BEGIN
    LOOP
        WITH batch AS (
            SELECT c.id
            FROM comms_channels c
            WHERE c.id::text > last_id
            ORDER BY c.id::text
            LIMIT batch_size
        ),
        inserted AS (
            INSERT INTO contacts_backfill_outbox (comms_channel_id, user_ids)
            SELECT
                b.id,
                jsonb_agg(p.user_id)
            FROM batch b
            JOIN comms_channel_participants p ON p.channel_id = b.id
            GROUP BY b.id
            RETURNING comms_channel_id
        )
        SELECT COUNT(*), MAX(b.id::text)
        INTO batch_count, last_id
        FROM batch b;

        EXIT WHEN batch_count < batch_size;
        PERFORM pg_sleep(0.5);
    END LOOP;
END $$;
