-- Track egress (recording) ID on active calls and archived call records
ALTER TABLE calls ADD COLUMN egress_id TEXT;
ALTER TABLE call_records ADD COLUMN egress_id TEXT;
