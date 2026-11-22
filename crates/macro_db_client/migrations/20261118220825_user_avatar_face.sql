SET LOCAL lock_timeout = '5s';

ALTER TABLE macro_user_info ADD COLUMN avatar_face JSONB;
