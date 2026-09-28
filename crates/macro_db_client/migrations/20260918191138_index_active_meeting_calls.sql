-- Active-call lookups and FK cleanup must not scan historical invitations.
CREATE INDEX call_meetings_active_call_id
    ON call_meetings (active_call_id)
    WHERE active_call_id IS NOT NULL;
