SET LOCAL lock_timeout = '2s';

DELETE FROM password_activity WHERE agent_user_id IS NOT NULL;
ALTER TABLE password_activity
    DROP CONSTRAINT password_activity_action_check,
    ADD CONSTRAINT password_activity_action_check CHECK (action IN (
        'create','update','delete','reveal','copy','share','totp_setup','totp_remove','totp_code'
    )),
    DROP COLUMN permission_revision,
    DROP COLUMN wake_id,
    DROP COLUMN agent_user_id;
ALTER TABLE password_totp_enrollments DROP COLUMN wake_id, DROP COLUMN agent_user_id;
ALTER TABLE password_write_intents DROP COLUMN agent_action, DROP COLUMN wake_id, DROP COLUMN agent_user_id;
UPDATE password_item_entities SET grants = COALESCE(
    (SELECT jsonb_agg(grant_entry) FROM jsonb_array_elements(grants) grant_entry WHERE grant_entry->>'kind' <> 'agent'),
    '[]'::jsonb
) WHERE grants @> '[{"kind":"agent"}]';
DROP TABLE password_agent_access_events;
DROP TABLE password_agent_access;
