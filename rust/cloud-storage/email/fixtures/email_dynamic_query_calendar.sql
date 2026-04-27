-- Calendar attachments fixture for testing the calendar_only filter.
-- Layers on top of `email_dynamic_query` — adds iCalendar / non-iCalendar
-- attachments to a subset of the existing threads.
--
-- Expected matches for calendar_only=true:
--   Thread 1 — .ics filename
--   Thread 2 — .ics filename (sent)
--   Thread 4 — application/ics mime (non-.ics filename)
--   Thread 5 — thread has both a .pdf and an .ics attachment on the same message
-- Not matched (have no attachments or only non-calendar attachments):
--   Thread 3, 6, 7, 8, 9, 10, 11

INSERT INTO email_attachments (id, message_id, filename, mime_type, created_at)
VALUES
    -- Thread 1 (inbox, from john): .ics filename → match
    ('90000001-0000-0000-0000-000000000001', '30000001-0000-0000-0000-000000000001',
     'invite.ics', 'text/calendar', NOW()),

    -- Thread 2 (sent): .ics filename → match
    ('90000002-0000-0000-0000-000000000002', '30000002-0000-0000-0000-000000000002',
     'event.ics', 'text/calendar', NOW()),

    -- Thread 4 (starred, inbox_visible): application/ics mime with non-.ics filename → match via mime
    ('90000004-0000-0000-0000-000000000004', '30000004-0000-0000-0000-000000000004',
     'calendar-invite', 'application/ics', NOW()),

    -- Thread 5 (important inbox, from john): a non-calendar PDF AND an .ics → match (at least one)
    ('90000005-0000-0000-0000-000000000005', '30000005-0000-0000-0000-000000000005',
     'notes.pdf', 'application/pdf', NOW()),
    ('90000005-0000-0000-0000-000000000006', '30000005-0000-0000-0000-000000000005',
     'team-meeting.ics', 'text/calendar', NOW()),

    -- Thread 7 (inbox with CC): only a non-calendar attachment → should NOT match
    ('90000007-0000-0000-0000-000000000007', '30000007-0000-0000-0000-000000000007',
     'report.pdf', 'application/pdf', NOW());
