INSERT INTO macro_user (id, username, email, stripe_customer_id)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'author', 'author@example.com', 'cus_time_author'),
    ('a2222222-2222-2222-2222-222222222222', 'editor', 'editor@example.com', 'cus_time_editor');

INSERT INTO "User" (id, email, macro_user_id)
VALUES
    ('macro|author@example.com', 'author@example.com', 'a1111111-1111-1111-1111-111111111111'),
    ('macro|editor@example.com', 'editor@example.com', 'a2222222-2222-2222-2222-222222222222');

INSERT INTO "Document" (id, name, "fileType", owner, "deletedAt")
VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'Write the brief', 'md', 'macro|author@example.com', NULL),
    ('00000000-0000-0000-0000-0000000000a2', 'Review the brief', 'md', 'macro|author@example.com', NULL),
    ('00000000-0000-0000-0000-0000000000b1', 'Meeting notes', 'md', 'macro|author@example.com', NULL),
    ('00000000-0000-0000-0000-0000000000c1', 'Old task', 'md', 'macro|author@example.com', now());

INSERT INTO document_sub_type (document_id, sub_type)
VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'task'),
    ('00000000-0000-0000-0000-0000000000a2', 'task'),
    ('00000000-0000-0000-0000-0000000000c1', 'task');
