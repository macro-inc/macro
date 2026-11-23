-- A trash larger than one page. Most of it is shaped like a folder trash:
-- every item shares one "deletedAt", so only the id orders them. A chat
-- trashed later, a document and a folder trashed earlier, a live document and
-- another owner's trash sit around it.
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES
    ('b2222222-2222-2222-2222-222222222222', 'large@example.com', 'large@example.com', 'stripe_large'),
    ('c3333333-3333-3333-3333-333333333333', 'other@example.com', 'other@example.com', 'stripe_other');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "macro_user_id")
VALUES
    ('macro|large@example.com', 'large@example.com', 'stripe_large', 'b2222222-2222-2222-2222-222222222222'),
    ('macro|other@example.com', 'other@example.com', 'stripe_other', 'c3333333-3333-3333-3333-333333333333');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "deletedAt")
SELECT 'folder-' || lpad(n::text, 2, '0'), 'folder ' || n, 'macro|large@example.com',
    CASE WHEN n = 1 THEN NULL ELSE 'folder-01' END, '2026-11-10 12:00:00'
FROM generate_series(1, 5) AS n;

INSERT INTO public."Document" ("id", "name", "fileType", "owner", "deletedAt", "projectId")
SELECT 'doc-' || lpad(n::text, 2, '0'), 'doc ' || n, 'pdf', 'macro|large@example.com',
    '2026-11-10 12:00:00', 'folder-0' || (n % 5 + 1)
FROM generate_series(1, 25) AS n;

INSERT INTO public."Chat" ("id", "name", "userId", "deletedAt", "projectId")
SELECT 'chat-' || lpad(n::text, 2, '0'), 'chat ' || n, 'macro|large@example.com',
    '2026-11-10 12:00:00', 'folder-01'
FROM generate_series(1, 5) AS n;

INSERT INTO public."Chat" ("id", "name", "userId", "deletedAt")
VALUES ('chat-newest', 'newest', 'macro|large@example.com', '2026-11-11 00:00:00');

INSERT INTO public."Project" ("id", "name", "userId", "deletedAt")
VALUES ('folder-oldest', 'oldest', 'macro|large@example.com', '2026-10-20 00:00:00');

INSERT INTO public."Document" ("id", "name", "fileType", "owner", "deletedAt")
VALUES
    ('doc-older', 'older', 'md', 'macro|large@example.com', '2026-11-01 08:00:00'),
    ('doc-live', 'live', 'md', 'macro|large@example.com', NULL),
    ('doc-other', 'other', 'md', 'macro|other@example.com', '2026-11-12 09:00:00');

INSERT INTO public."DocumentBom" ("documentId")
SELECT id FROM public."Document"
WHERE owner IN ('macro|large@example.com', 'macro|other@example.com');
