-- Validate after the column/constraint migration commits and releases its write locks.
ALTER TABLE calls VALIDATE CONSTRAINT calls_meeting_id_fkey;
ALTER TABLE call_records VALIDATE CONSTRAINT call_records_meeting_id_fkey;
