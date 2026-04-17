-- Replace recording_url with recording_key on both calls and call_records.
-- Existing URLs are transformed by stripping everything up to and including `calls/`,
-- leaving just the S3 object key (e.g. `UUID/TIMESTAMP.mp4`).

ALTER TABLE calls ADD COLUMN recording_key TEXT;
UPDATE calls SET recording_key = regexp_replace(recording_url, '^.*/calls/', '')
  WHERE recording_url IS NOT NULL;
ALTER TABLE calls DROP COLUMN recording_url;

ALTER TABLE call_records ADD COLUMN recording_key TEXT;
UPDATE call_records SET recording_key = regexp_replace(recording_url, '^.*/calls/', '')
  WHERE recording_url IS NOT NULL;
ALTER TABLE call_records DROP COLUMN recording_url;
