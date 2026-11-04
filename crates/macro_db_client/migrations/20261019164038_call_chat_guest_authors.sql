SET LOCAL lock_timeout = '5s';

ALTER TABLE comms_messages ADD COLUMN guest_name text;

-- Guest attribution is only meaningful on call conversations. Existing writers
-- omit the nullable name; validation of historical rows can run separately.
ALTER TABLE comms_messages ADD CONSTRAINT comms_messages_guest_author
CHECK (
    (guest_name IS NULL AND sender_id NOT LIKE 'guest|%')
    OR (parent_entity_type = 'call' AND sender_id LIKE 'guest|%'
        AND guest_name IS NOT NULL AND length(guest_name) BETWEEN 1 AND 80)
) NOT VALID;
