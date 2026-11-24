-- Reserve half the bounded window for pre-migration NULL-provider work.
-- Limit raw keys BEFORE SKIP LOCKED, so a held prefix cannot create an
-- unbounded index walk. Dependency probes run lazily in the per-ID acquire.
WITH native AS MATERIALIZED (
    SELECT message_id AS id FROM email_mailbox_drafts
    WHERE $2 AND provider = $1::text::email_user_provider_enum AND parked_at IS NULL
        AND (CASE WHEN state IN ('pending','running','synced') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END) < 'infinity'::timestamptz
        AND (CASE WHEN state IN ('pending','running','synced') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END) <= now()
    ORDER BY (CASE WHEN state IN ('pending','running','synced') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END), message_id LIMIT 32
),
native_recovery AS MATERIALIZED (
    SELECT message_id AS id FROM email_mailbox_drafts
    WHERE NOT $2 AND provider = $1::text::email_user_provider_enum AND checkpoint->>'stage' IN ('creating','submitting','confirming') AND parked_at IS NULL
        AND (CASE WHEN state IN ('pending','running','synced') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END) < 'infinity'::timestamptz
        AND (CASE WHEN state IN ('pending','running','synced') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END) <= now()
    ORDER BY (CASE WHEN state IN ('pending','running','synced') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END), message_id LIMIT 32
),
legacy AS MATERIALIZED (
    SELECT message_id AS id FROM email_mailbox_drafts
    WHERE $2 AND provider IS NULL AND parked_at IS NULL
        AND (CASE WHEN state IN ('pending','running','synced') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END) < 'infinity'::timestamptz
        AND (CASE WHEN state IN ('pending','running','synced') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END) <= now()
    ORDER BY (CASE WHEN state IN ('pending','running','synced') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END), message_id LIMIT 32
),
legacy_recovery AS MATERIALIZED (
    SELECT message_id AS id FROM email_mailbox_drafts
    WHERE NOT $2 AND provider IS NULL AND checkpoint->>'stage' IN ('creating','submitting','confirming') AND parked_at IS NULL
        AND (CASE WHEN state IN ('pending','running','synced') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END) < 'infinity'::timestamptz
        AND (CASE WHEN state IN ('pending','running','synced') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END) <= now()
    ORDER BY (CASE WHEN state IN ('pending','running','synced') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END), message_id LIMIT 32
),
keys AS MATERIALIZED (SELECT id FROM native UNION ALL SELECT id FROM native_recovery UNION ALL SELECT id FROM legacy UNION ALL SELECT id FROM legacy_recovery),
locked AS MATERIALIZED (
    SELECT d.* FROM keys k CROSS JOIN LATERAL (
        SELECT d.message_id AS id,d.link_id,d.generation,d.provider,d.available_at,d.lease_until,d.parked_at,d.blocked_until,d.state,d.checkpoint
        FROM email_mailbox_drafts d WHERE d.message_id=k.id
        LIMIT 1 FOR UPDATE OF d SKIP LOCKED
    ) d
),
enriched AS MATERIALIZED (
    SELECT d.*, l.provider AS actual_provider,
        (l.is_sync_active AND l.mailbox_unavailable_at IS NULL
            AND l.sync_generation=d.generation) AS parent_ready,
        CASE WHEN NOT schedule.sent AND NOT schedule.processing
            THEN schedule.send_time ELSE NULL END AS send_time
    FROM locked d CROSS JOIN LATERAL (
        SELECT provider,is_sync_active,mailbox_unavailable_at,sync_generation
        FROM email_links WHERE id=d.link_id LIMIT 1
    ) l LEFT JOIN LATERAL (
        SELECT send_time,sent,processing FROM email_scheduled_messages
        WHERE message_id=d.id AND link_id=d.link_id
        LIMIT 1
    ) schedule ON true
),
changes AS MATERIALIZED (
    SELECT d.*, CASE WHEN d.state='synced' AND d.send_time IS NULL THEN 'infinity'::timestamptz
            WHEN d.state='synced' AND d.send_time>now() THEN d.send_time
            ELSE NULL END AS new_blocked_until FROM enriched d
),
maintained AS (
    UPDATE email_mailbox_drafts d
    SET provider=c.actual_provider,
        parked_at=CASE WHEN NOT c.parent_ready THEN clock_timestamp() ELSE NULL END,
        blocked_until=c.new_blocked_until
    FROM changes c WHERE d.message_id=c.id
        AND (d.provider IS DISTINCT FROM c.actual_provider OR NOT c.parent_ready
            OR d.blocked_until IS DISTINCT FROM c.new_blocked_until)
    RETURNING d.message_id
)
SELECT COALESCE(array_agg(id ORDER BY GREATEST(available_at,COALESCE(lease_until,'-infinity'::timestamptz),COALESCE(new_blocked_until,'-infinity'::timestamptz)),id),ARRAY[]::uuid[]) AS "ids!",
    (SELECT count(*) FROM maintained) AS "maintained!"
FROM changes
