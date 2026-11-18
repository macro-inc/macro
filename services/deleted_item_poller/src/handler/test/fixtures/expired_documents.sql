-- 25 documents in trash since before the 2026-02-01 cutoff, three to an hour,
-- so documents with the same "deletedAt" straddle page boundaries.
INSERT INTO "Document" (id, name, owner, "deletedAt")
SELECT
    'expired-' || lpad(n::text, 2, '0'),
    'expired ' || n,
    'macro|owner@example.com',
    '2026-01-01 00:00:00'::timestamp + (n / 3) * interval '1 hour'
FROM generate_series(1, 25) AS n;

-- Trashed after the cutoff: not expired yet.
INSERT INTO "Document" (id, name, owner, "deletedAt")
VALUES
    ('recent-1', 'recent 1', 'macro|owner@example.com', '2026-03-01 00:00:00'),
    ('recent-2', 'recent 2', 'macro|owner@example.com', '2026-03-01 00:00:00');

-- Never trashed.
INSERT INTO "Document" (id, name, owner, "deletedAt")
VALUES
    ('live-1', 'live 1', 'macro|owner@example.com', NULL),
    ('live-2', 'live 2', 'macro|owner@example.com', NULL);
