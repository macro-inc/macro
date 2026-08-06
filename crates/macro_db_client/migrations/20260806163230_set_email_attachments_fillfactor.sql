-- This reloption does not rewrite existing pages. The reserved space benefits newly written or
-- repacked pages and future HOT-eligible attachment claim updates.
ALTER TABLE email_attachments SET (fillfactor = 90);
