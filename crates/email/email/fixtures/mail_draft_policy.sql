-- Extends email_signal_flag with both draft and non-draft inline invitations,
-- and a notification draft that must remain noise even with sender overrides.
INSERT INTO email_message_calendar_invites (message_id, component_id, snapshot)
VALUES
 ('00000000-0000-0000-0000-00000000e501', 'inline-invite', '{}'),
 ('00000000-0000-0000-0000-00000000e505', 'draft-inline-invite', '{}');

INSERT INTO email_messages (id, thread_id, link_id, from_contact_id,
    is_sent, is_read, is_starred, is_draft, has_attachments, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e510',
    '00000000-0000-0000-0000-00000000e207',
    '00000000-0000-0000-0000-000000000e01',
    '00000000-0000-0000-0000-0000000ce004',
    false, true, false, true, false, NOW(), NOW());

UPDATE email_contacts SET email_address = 'no-reply@NOTIFICATION.MACRO.COM'
WHERE id = '00000000-0000-0000-0000-0000000ce004';
