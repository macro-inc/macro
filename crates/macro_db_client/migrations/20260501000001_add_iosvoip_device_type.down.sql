-- Rollback: remove 'iosvoip' from notification_device_type_option.
--
-- PREREQUISITE: all rows with device_type = 'iosvoip' must be deleted before
-- running this, otherwise the USING cast below will fail.
--
-- PostgreSQL has no ALTER TYPE ... DROP VALUE, so the only safe approach is:
--   1. delete/migrate any 'iosvoip' rows
--   2. create a replacement enum without the value
--   3. alter the column with an explicit USING cast
--   4. drop the old enum and rename the replacement
--
-- This script will raise an error and roll back if any 'iosvoip' rows remain.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM notification_user_device_registration WHERE device_type = 'iosvoip'
  ) THEN
    RAISE EXCEPTION
      'Cannot remove iosvoip: rows with device_type = ''iosvoip'' still exist in notification_user_device_registration';
  END IF;
END;
$$;

CREATE TYPE notification_device_type_option_new AS ENUM ('ios', 'android');

ALTER TABLE notification_user_device_registration
  ALTER COLUMN device_type TYPE notification_device_type_option_new
  USING device_type::text::notification_device_type_option_new;

DROP TYPE notification_device_type_option;

ALTER TYPE notification_device_type_option_new RENAME TO notification_device_type_option;
