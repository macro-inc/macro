-- One team (author, editor, viewer, quiet), an outsider on another team, and a
-- former member with no team. Three live tasks and one in the Trash. Entries in
-- November 2026, one in October, one on the trashed task.
INSERT INTO macro_user (id, username, email, stripe_customer_id)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'author', 'author@example.com', 'cus_report_author'),
    ('a2222222-2222-2222-2222-222222222222', 'editor', 'editor@example.com', 'cus_report_editor'),
    ('a3333333-3333-3333-3333-333333333333', 'viewer', 'viewer@example.com', 'cus_report_viewer'),
    ('a4444444-4444-4444-4444-444444444444', 'quiet', 'quiet@example.com', 'cus_report_quiet'),
    ('a5555555-5555-5555-5555-555555555555', 'outsider', 'outsider@example.com', 'cus_report_outsider'),
    ('a6666666-6666-6666-6666-666666666666', 'former', 'former@example.com', 'cus_report_former');

INSERT INTO "User" (id, email, macro_user_id)
VALUES
    ('macro|author@example.com', 'author@example.com', 'a1111111-1111-1111-1111-111111111111'),
    ('macro|editor@example.com', 'editor@example.com', 'a2222222-2222-2222-2222-222222222222'),
    ('macro|viewer@example.com', 'viewer@example.com', 'a3333333-3333-3333-3333-333333333333'),
    ('macro|quiet@example.com', 'quiet@example.com', 'a4444444-4444-4444-4444-444444444444'),
    ('macro|outsider@example.com', 'outsider@example.com', 'a5555555-5555-5555-5555-555555555555'),
    ('macro|former@example.com', 'former@example.com', 'a6666666-6666-6666-6666-666666666666');

INSERT INTO team (id, name, owner_id)
VALUES
    ('70000000-0000-0000-0000-000000000001', 'Studio', 'macro|author@example.com'),
    ('70000000-0000-0000-0000-000000000002', 'Elsewhere', 'macro|outsider@example.com');

INSERT INTO team_user (user_id, team_id, team_role)
VALUES
    ('macro|author@example.com', '70000000-0000-0000-0000-000000000001', 'owner'),
    ('macro|editor@example.com', '70000000-0000-0000-0000-000000000001', 'member'),
    ('macro|viewer@example.com', '70000000-0000-0000-0000-000000000001', 'member'),
    ('macro|quiet@example.com', '70000000-0000-0000-0000-000000000001', 'member'),
    ('macro|outsider@example.com', '70000000-0000-0000-0000-000000000002', 'owner');

INSERT INTO "Document" (id, name, "fileType", owner, "deletedAt")
VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'Write the brief', 'md', 'macro|author@example.com', NULL),
    ('00000000-0000-0000-0000-0000000000a2', '=Review the brief', 'md', 'macro|author@example.com', NULL),
    ('00000000-0000-0000-0000-0000000000a3', 'Hidden task', 'md', 'macro|editor@example.com', NULL),
    ('00000000-0000-0000-0000-0000000000c1', 'Old task', 'md', 'macro|author@example.com', now());

INSERT INTO document_sub_type (document_id, sub_type)
VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'task'),
    ('00000000-0000-0000-0000-0000000000a2', 'task'),
    ('00000000-0000-0000-0000-0000000000a3', 'task'),
    ('00000000-0000-0000-0000-0000000000c1', 'task');

INSERT INTO time_entry (id, task_id, user_id, entry_date, minutes, note, source)
VALUES
    ('e0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'macro|author@example.com', '2026-11-02', 60, 'Outline', 'manual'),
    ('e0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'macro|author@example.com', '2026-11-03', 30, NULL, 'timer'),
    ('e0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'macro|editor@example.com', '2026-11-02', 45, '-edits', 'manual'),
    ('e0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a2', 'macro|editor@example.com', '2026-11-04', 120, NULL, 'manual'),
    ('e0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a3', 'macro|editor@example.com', '2026-11-04', 90, NULL, 'manual'),
    ('e0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a2', 'macro|viewer@example.com', '2026-11-03', 15, NULL, 'manual'),
    ('e0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000a1', 'macro|outsider@example.com', '2026-11-02', 10, NULL, 'manual'),
    ('e0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000a2', 'macro|former@example.com', '2026-11-05', 20, NULL, 'manual'),
    ('e0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000c1', 'macro|author@example.com', '2026-11-02', 300, NULL, 'manual'),
    ('e0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000a1', 'macro|author@example.com', '2026-10-30', 999, NULL, 'manual');
