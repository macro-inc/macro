-- Reserve 16 slots for pre-migration NULL-provider work alongside 32 native
-- slots, bounding routing writes while guaranteeing the legacy queue drains.
-- Limit raw keys BEFORE SKIP LOCKED, so a held prefix cannot create an
-- unbounded index walk. Every later LATERAL is one of these <=64 primary keys.
WITH native AS MATERIALIZED (
    SELECT id FROM email_mailbox_commands
    WHERE provider = $1::text::email_user_provider_enum AND parked_at IS NULL
        AND (CASE WHEN status IN ('pending','running') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END) < 'infinity'::timestamptz
        AND (CASE WHEN status IN ('pending','running') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END) <= now()
    ORDER BY (CASE WHEN status IN ('pending','running') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END), id LIMIT 32
),
legacy AS MATERIALIZED (
    SELECT id FROM email_mailbox_commands
    WHERE provider IS NULL AND parked_at IS NULL
        AND (CASE WHEN status IN ('pending','running') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END) < 'infinity'::timestamptz
        AND (CASE WHEN status IN ('pending','running') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END) <= now()
    ORDER BY (CASE WHEN status IN ('pending','running') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END), id LIMIT 16
),
keys AS MATERIALIZED (SELECT id FROM native UNION ALL SELECT id FROM legacy),
locked AS MATERIALIZED (
    SELECT d.* FROM keys k CROSS JOIN LATERAL (
        SELECT d.id AS id,d.link_id,d.generation,d.provider,d.available_at,d.lease_until,d.parked_at,d.blocked_until,d.status,d.accepted_order,d.intent
        FROM email_mailbox_commands d WHERE d.id=k.id
        LIMIT 1 FOR UPDATE OF d SKIP LOCKED
    ) d
),
enriched AS MATERIALIZED (
    SELECT d.*, l.provider AS actual_provider,
        (l.is_sync_active AND l.mailbox_unavailable_at IS NULL
            AND l.sync_generation=d.generation) AS parent_ready
    FROM locked d CROSS JOIN LATERAL (
        SELECT provider,is_sync_active,mailbox_unavailable_at,sync_generation
        FROM email_links WHERE id=d.link_id LIMIT 1
    ) l
),
changes AS MATERIALIZED (
    SELECT d.*, CASE WHEN d.intent->>'kind' IS NULL OR d.intent->>'kind' NOT IN ('read','flagged','archived','trashed','junk','category')
                THEN now()+interval '60 seconds'
            ELSE NULL END AS new_blocked_until FROM enriched d
),
maintained AS (
    UPDATE email_mailbox_commands d
    SET provider=c.actual_provider,
        parked_at=CASE WHEN NOT c.parent_ready THEN clock_timestamp() ELSE NULL END,
        blocked_until=c.new_blocked_until
    FROM changes c WHERE d.id=c.id
        AND (d.provider IS DISTINCT FROM c.actual_provider OR NOT c.parent_ready
            OR d.blocked_until IS DISTINCT FROM c.new_blocked_until)
    RETURNING d.id
)
SELECT COALESCE(array_agg(id ORDER BY GREATEST(available_at,COALESCE(lease_until,'-infinity'::timestamptz),COALESCE(new_blocked_until,'-infinity'::timestamptz)),id),ARRAY[]::uuid[]) AS "ids!",
    (SELECT count(*) FROM maintained) AS "maintained!"
FROM changes
