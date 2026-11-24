-- Inspect one due candidate before target work. The caller shares one target
-- budget across candidates and stops at its first lease or an exhausted budget.
WITH keys AS MATERIALIZED (SELECT $3::uuid AS id),
eligible AS MATERIALIZED (
    SELECT c.*, parent.grant_generation
    FROM keys k CROSS JOIN LATERAL (
        SELECT * FROM email_mailbox_commands c WHERE c.id=k.id LIMIT 1
    ) c CROSS JOIN LATERAL (
        SELECT l.grant_generation FROM email_links l
        WHERE l.id=c.link_id AND l.sync_generation=c.generation
            AND l.is_sync_active AND l.mailbox_unavailable_at IS NULL
            AND l.provider=$2::text::email_user_provider_enum
            AND l.provider=c.provider LIMIT 1
    ) parent
    WHERE c.status IN ('pending','running')
        AND c.intent->>'kind' IN ('read','flagged','archived','trashed','junk','category')
        AND c.parked_at IS NULL
        AND GREATEST(c.available_at,COALESCE(c.lease_until,'-infinity'::timestamptz),COALESCE(c.blocked_until,'-infinity'::timestamptz))<=now()
        AND (c.lease_until IS NULL OR c.lease_until<now())
),
candidate AS MATERIALIZED (
    SELECT * FROM eligible c
    ORDER BY GREATEST(c.available_at,COALESCE(c.lease_until,'-infinity'::timestamptz),COALESCE(c.blocked_until,'-infinity'::timestamptz)),c.id LIMIT 1
),
sized AS MATERIALIZED (
    SELECT c.*, (SELECT count(*) FROM (
        SELECT 1 FROM email_mailbox_command_targets t WHERE t.command_id=c.id
        LIMIT ($6::bigint+1)
    ) targets) AS target_count
    FROM candidate c
),
permitted AS MATERIALIZED (
    SELECT c.*,
        (c.action_id IS NULL AND c.target_count>$6::bigint) AS legacy_wide,
        ((c.target_count<=$6::bigint AND c.target_count<=$4::bigint)
            OR (c.action_id IS NULL AND c.target_count>$6::bigint AND $5::bool)) AS evaluate
    FROM sized c
),
checked AS MATERIALIZED (
    SELECT c.*,
        EXISTS (SELECT 1 FROM email_mailbox_command_targets current
            CROSS JOIN LATERAL (
                SELECT earlier.command_id FROM email_mailbox_command_targets earlier
                CROSS JOIN LATERAL (
                    SELECT id FROM email_mailbox_commands prior WHERE prior.id=earlier.command_id
                        AND prior.link_id=c.link_id AND prior.generation=c.generation
                        AND prior.status IN ('pending','running','confirming')
                        AND prior.accepted_order<c.accepted_order LIMIT 1
                ) parent
                WHERE earlier.message_id=current.message_id
                    AND earlier.parent_link_id=c.link_id
                    AND earlier.parent_generation=c.generation
                    AND earlier.parent_unfinished
                    AND earlier.parent_accepted_order<c.accepted_order
                ORDER BY earlier.parent_accepted_order,earlier.command_id LIMIT 1
            ) earlier
            WHERE current.command_id=c.id
        )
        OR EXISTS (SELECT 1 FROM email_mailbox_command_targets t
            JOIN email_mailbox_drafts draft ON draft.message_id=t.message_id
            WHERE t.command_id=c.id AND draft.lease_id IS NOT NULL
                AND draft.lease_until>now() OFFSET 0)
        OR (c.intent->>'kind'='category' AND EXISTS (
            SELECT 1 FROM email_mailbox_settings_work s
            WHERE s.link_id=c.link_id AND s.kind='create_label'
                AND s.resource_key=c.intent->'value'->>'name'
                AND s.completed_revision<s.revision)) AS dependency_blocked
    FROM permitted c WHERE c.evaluate
),
blocked AS (
    UPDATE email_mailbox_commands c SET blocked_until=now()+interval '60 seconds'
    FROM checked q WHERE c.id=q.id AND q.dependency_blocked
    RETURNING c.id
),
claimed AS (
    UPDATE email_mailbox_commands c
    SET lease_id=$1,lease_until=now()+interval '3 minutes',status='running',
        attempts=c.attempts+1,updated_at=now()
    FROM checked q WHERE c.id=q.id AND NOT q.dependency_blocked
    RETURNING c.id
)
SELECT c.id AS "id!",c.link_id AS "link_id!",c.generation AS "generation!",
    c.grant_generation AS "grant_generation!",c.intent AS "intent!",c.attempts+CASE WHEN EXISTS(SELECT 1 FROM claimed) THEN 1 ELSE 0 END AS "attempts!",
    c.target_count AS "target_count!",c.legacy_wide AS "legacy_wide!",
    NOT c.evaluate AS "budget_exhausted!",
    EXISTS(SELECT 1 FROM claimed) AS "leased!",
    EXISTS(SELECT 1 FROM blocked) AS "blocked!"
FROM permitted c
