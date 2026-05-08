-- NOTE: PostgreSQL does not support removing enum values within a transaction,
-- so this migration is not atomically reversible. See the companion .down.sql
-- for the manual rollback procedure, which requires all 'iosvoip' rows to be
-- deleted before it can run safely.
ALTER TYPE notification_device_type_option ADD VALUE IF NOT EXISTS 'iosvoip';
