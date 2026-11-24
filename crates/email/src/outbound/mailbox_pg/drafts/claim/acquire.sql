-- Inspect one locked draft. Reserve a bounded live-lease prefix, then use
-- target primary-key point probes; command width never drives draft work.
WITH keys AS MATERIALIZED (SELECT $4::uuid AS id),
candidate AS MATERIALIZED (
    SELECT d.*, parent.grant_generation
    FROM keys k CROSS JOIN LATERAL (
        SELECT * FROM email_mailbox_drafts d WHERE d.message_id=k.id LIMIT 1
    ) d CROSS JOIN LATERAL (
        SELECT l.grant_generation FROM email_links l
        WHERE l.id=d.link_id AND l.sync_generation=d.generation
            AND l.is_sync_active AND l.mailbox_unavailable_at IS NULL
            AND l.provider=$3::text::email_user_provider_enum
            AND l.provider=d.provider LIMIT 1
    ) parent LEFT JOIN LATERAL (
        -- Keep time/state eligibility outside this key-only lookup; stale
        -- due-time statistics must not select a global schedule range.
        SELECT s.send_time,s.sent,s.processing FROM email_scheduled_messages s
        WHERE s.link_id=d.link_id AND s.message_id=d.message_id
        LIMIT 1
    ) due ON true
    WHERE d.state IN ('pending','running','synced')
        AND ($2 OR d.checkpoint->>'stage' IN ('creating','submitting','confirming'))
        AND (d.state IN ('pending','running') OR (
            due.send_time<=now() AND NOT due.sent AND NOT due.processing))
        AND d.parked_at IS NULL AND GREATEST(d.available_at,COALESCE(d.lease_until,'-infinity'::timestamptz),COALESCE(d.blocked_until,'-infinity'::timestamptz))<=now()
        AND (d.lease_until IS NULL OR d.lease_until<now())
),
live_leases AS MATERIALIZED (
    SELECT c.id
    FROM candidate d CROSS JOIN LATERAL (
        SELECT id FROM email_mailbox_commands c
        WHERE c.link_id=d.link_id AND c.generation=d.generation
            AND c.status IN ('pending','running','confirming')
            AND c.lease_id IS NOT NULL AND c.lease_until>now()
        ORDER BY c.lease_until,c.id LIMIT ($5::bigint+1) OFFSET 0
    ) c
),
sized AS MATERIALIZED (
    SELECT d.*, (SELECT count(*) FROM live_leases) AS scope_leases FROM candidate d
),
permitted AS MATERIALIZED (
    SELECT d.*, (scope_leases>$6::bigint) AS exclusion_overflow,
        (scope_leases<=$5::bigint OR scope_leases>$6::bigint) AS evaluate
    FROM sized d
),
checked AS MATERIALIZED (
    SELECT d.*, exclusion_overflow OR EXISTS (
        SELECT 1 FROM (SELECT id FROM live_leases LIMIT $5::bigint) c
        WHERE EXISTS (SELECT 1 FROM email_mailbox_command_targets t
            WHERE t.command_id=c.id AND t.message_id=d.message_id)
    ) AS dependency_blocked
    FROM permitted d WHERE d.evaluate
),
blocked AS (
    -- An over-cap scope cannot be proved safe in this budget. Defer locally,
    -- letting orphaned leases expire; preserve actual retry and lease floors.
    UPDATE email_mailbox_drafts d SET blocked_until=now()+interval '60 seconds'
    FROM checked c WHERE d.message_id=c.message_id AND c.dependency_blocked
    RETURNING d.message_id
),
claimed AS (
    UPDATE email_mailbox_drafts d
    SET claimed_content=d.desired_content,state='running',lease_id=$1,
        lease_until=now()+interval '3 minutes',updated_at=now()
    FROM checked c WHERE d.message_id=c.message_id AND NOT c.dependency_blocked
    RETURNING d.message_id
)
SELECT d.message_id AS "message_id!",d.link_id AS "link_id!",d.generation AS "generation!",
    d.grant_generation AS "grant_generation!",d.revision AS "revision!",d.actor_id AS "actor_id!",
    CASE WHEN EXISTS(SELECT 1 FROM claimed) THEN d.desired_content ELSE '{}'::jsonb END AS "desired_content!",
    d.provider_id,d.base_version,
    d.delete_requested AS "delete_requested!",
    CASE WHEN EXISTS(SELECT 1 FROM claimed) THEN d.checkpoint ELSE NULL END AS checkpoint,
    CASE WHEN d.evaluate THEN LEAST(d.scope_leases,$5::bigint) ELSE 0 END AS "probe_count!",
    d.scope_leases AS "scope_leases!",d.exclusion_overflow AS "exclusion_overflow!",
    NOT d.evaluate AS "budget_exhausted!",
    EXISTS(SELECT 1 FROM claimed) AS "leased!",EXISTS(SELECT 1 FROM blocked) AS "blocked!"
FROM permitted d
