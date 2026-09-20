CREATE INDEX email_message_calendar_invites_uid
    ON email_message_calendar_invites ((snapshot->>'uid'));
