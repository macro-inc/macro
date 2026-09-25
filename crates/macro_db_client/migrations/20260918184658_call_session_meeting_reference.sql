-- Preserve the invitation association after an active session is archived.
-- Deleting an invitation or its owner leaves the protected call record intact.
ALTER TABLE calls ADD COLUMN meeting_id UUID;
ALTER TABLE call_records ADD COLUMN meeting_id UUID;

ALTER TABLE calls ADD CONSTRAINT calls_meeting_id_fkey
    FOREIGN KEY (meeting_id) REFERENCES call_meetings(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE call_records ADD CONSTRAINT call_records_meeting_id_fkey
    FOREIGN KEY (meeting_id) REFERENCES call_meetings(id) ON DELETE SET NULL NOT VALID;
