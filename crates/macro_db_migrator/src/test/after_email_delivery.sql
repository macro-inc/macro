DO $$
BEGIN
    IF (SELECT approved_attachments FROM email_scheduled_messages
        WHERE message_id = '00000000-0000-0000-0000-00000000e501')
        IS DISTINCT FROM '{"uploaded": ["f0000000-0000-0000-0000-000000000002"],
                           "forwarded": ["f0000000-0000-0000-0000-000000000001"]}'::jsonb
    THEN
        RAISE EXCEPTION 'Upgrade did not capture existing attachment identities';
    END IF;

    IF EXISTS (SELECT 1 FROM email_scheduled_messages
               WHERE delivery_status <> 'ready' OR delivery_claim_id IS NOT NULL
                  OR delivery_lease_expires_at IS NOT NULL OR delivery_started_at IS NOT NULL
                  OR delivery_message_id IS NOT NULL)
    THEN
        RAISE EXCEPTION 'Upgrade changed legacy delivery defaults';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM email_scheduled_messages
                   WHERE message_id = '00000000-0000-0000-0000-00000000e502'
                     AND processing AND NOT sent)
       OR NOT EXISTS (SELECT 1 FROM email_scheduled_messages
                      WHERE message_id = '00000000-0000-0000-0000-00000000e503'
                        AND sent AND NOT processing)
    THEN
        RAISE EXCEPTION 'Upgrade changed existing processing or delivery state';
    END IF;
END;
$$;
