-- Preserve the invitation association after an active session is archived.
-- Deleting an invitation or its owner leaves the protected call record intact.
ALTER TABLE calls ADD COLUMN meeting_id UUID REFERENCES call_meetings(id) ON DELETE SET NULL;
ALTER TABLE call_records ADD COLUMN meeting_id UUID REFERENCES call_meetings(id) ON DELETE SET NULL;
