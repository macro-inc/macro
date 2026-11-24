-- One draft or at most 64 targets of a settled command. Every row update is
-- reached by primary key; no mailbox-wide sweep is added to settlement.
WITH targets AS MATERIALIZED (
    (SELECT $4::uuid AS message_id WHERE $4::uuid IS NOT NULL)
    UNION ALL
    (SELECT message_id FROM email_mailbox_command_targets
        WHERE command_id=$3 AND $4::uuid IS NULL
        ORDER BY message_id LIMIT 64)
), label_window AS MATERIALIZED (
    SELECT id FROM email_mailbox_commands
    WHERE $5::text IS NOT NULL AND link_id=$1 AND generation=$2
        AND status IN ('pending','running','confirming')
    ORDER BY accepted_order LIMIT 64
), label_heads AS MATERIALIZED (
    SELECT c.id FROM label_window w CROSS JOIN LATERAL (
        SELECT id,intent FROM email_mailbox_commands WHERE id=w.id LIMIT 1
    ) c WHERE c.intent->>'kind'='category' AND c.intent->'value'->>'name'=$5
), heads AS MATERIALIZED (
    SELECT DISTINCT next.id FROM targets t CROSS JOIN LATERAL (
        SELECT indexed.command_id AS id FROM email_mailbox_command_targets indexed
        CROSS JOIN LATERAL (
            SELECT id,link_id,generation,status FROM email_mailbox_commands c
            WHERE c.id=indexed.command_id LIMIT 1
        ) parent
        WHERE indexed.message_id=t.message_id
            AND indexed.parent_link_id=$1 AND indexed.parent_generation=$2
            AND indexed.parent_unfinished
            AND parent.link_id=$1 AND parent.generation=$2
            AND parent.status IN ('pending','running','confirming')
            AND ($3::uuid IS NULL OR indexed.command_id<>$3)
        ORDER BY indexed.parent_accepted_order,indexed.command_id LIMIT 1
    ) next
    UNION SELECT id FROM label_heads
), ordered_heads AS MATERIALIZED (
    SELECT id FROM heads ORDER BY id
), locked_commands AS MATERIALIZED (
    SELECT c.* FROM ordered_heads h CROSS JOIN LATERAL (
        SELECT id,blocked_until FROM email_mailbox_commands WHERE id=h.id
        LIMIT 1 FOR UPDATE SKIP LOCKED
    ) c
), commands AS (
    UPDATE email_mailbox_commands c SET blocked_until=NULL
    FROM locked_commands k WHERE c.id=k.id AND k.blocked_until IS NOT NULL
    RETURNING c.id
), ordered_targets AS MATERIALIZED (
    SELECT DISTINCT message_id FROM targets ORDER BY message_id
), locked_drafts AS MATERIALIZED (
    SELECT d.* FROM ordered_targets t CROSS JOIN LATERAL (
        SELECT message_id,link_id,generation,blocked_until
        FROM email_mailbox_drafts WHERE message_id=t.message_id LIMIT 1 FOR UPDATE SKIP LOCKED
    ) d
), drafts AS (
    UPDATE email_mailbox_drafts d SET blocked_until=NULL
    FROM locked_drafts k WHERE d.message_id=k.message_id
        AND k.link_id=$1 AND k.generation=$2 AND k.blocked_until IS NOT NULL
    RETURNING d.message_id
)
SELECT ((SELECT count(*) FROM commands)+(SELECT count(*) FROM drafts)) AS "rows_woken!"
