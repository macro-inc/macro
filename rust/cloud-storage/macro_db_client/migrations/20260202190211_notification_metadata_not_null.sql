-- Make notification.metadata non-nullable.
-- Existing NULL rows get an empty JSON object as a default.
UPDATE notification SET metadata = '{}' WHERE metadata IS NULL;
ALTER TABLE notification ALTER COLUMN metadata SET DEFAULT '{}';
ALTER TABLE notification ALTER COLUMN metadata SET NOT NULL;
