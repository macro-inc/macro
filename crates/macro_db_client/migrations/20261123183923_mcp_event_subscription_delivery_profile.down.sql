SET LOCAL lock_timeout = '5s';

ALTER TABLE mcp_event_subscription
    DROP COLUMN previous_secret_expires_at,
    DROP COLUMN previous_secret_encryption_version,
    DROP COLUMN previous_secret_kms_key_id,
    DROP COLUMN previous_secret_ciphertext,
    DROP COLUMN delivery_profile;
