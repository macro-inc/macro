-- Visibility stays scoped to a current-generation action on this thread.
-- Once a group is visible, retained terminal chunks from a previous generation
-- still contribute to its outcome; reconnect must not erase an early failure.
WITH latest AS MATERIALIZED (
    SELECT DISTINCT ON(c.intent->>'kind',c.intent->'value'->>'name')
        c.id,c.action_id,c.intent,c.updated_at
    FROM email_mailbox_commands c JOIN email_links l
        ON l.id=c.link_id AND l.sync_generation=c.generation
    WHERE c.link_id=$1 AND EXISTS (
        SELECT 1 FROM email_mailbox_command_targets t
        JOIN email_messages m ON m.id=t.message_id
        WHERE t.command_id=c.id AND m.thread_id=$2 AND m.link_id=$1
    )
    ORDER BY c.intent->>'kind',c.intent->'value'->>'name',c.accepted_order DESC
    LIMIT 100
)
SELECT COALESCE(l.action_id,l.id) AS "id!",l.intent AS "intent!",
    CASE WHEN states.pending THEN 'pending'
        WHEN states.cancelled THEN 'cancelled'
        WHEN states.failed THEN 'failed'
        WHEN states.succeeded THEN 'succeeded'
        ELSE NULL END AS "status!",
    COALESCE(states.updated_at,l.updated_at) AS "updated_at!"
FROM latest l CROSS JOIN LATERAL (
    SELECT bool_or(member.status IN ('pending','running','confirming')) AS pending,
        bool_or(member.status IN ('cancelled','unknown')) AS cancelled,
        bool_or(member.status IN ('failed','conflict')) AS failed,
        bool_and(member.status='succeeded') AS succeeded,
        max(member.updated_at) AS updated_at
    FROM (
        SELECT status,updated_at FROM email_mailbox_commands
        WHERE link_id=$1 AND action_id=l.action_id
        UNION ALL
        SELECT status,updated_at FROM email_mailbox_commands
        WHERE id=l.id AND l.action_id IS NULL
    ) member
) states
