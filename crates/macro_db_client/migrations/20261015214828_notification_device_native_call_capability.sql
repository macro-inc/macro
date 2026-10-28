-- Existing binaries omit this capability and must retain ordinary Android alerts.
SET LOCAL lock_timeout = '5s';
ALTER TABLE notification_user_device_registration
    ADD COLUMN native_call_capable BOOLEAN NOT NULL DEFAULT FALSE;
