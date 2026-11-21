-- Keep eligibility aligned with lock_mailbox_domains.sql; settings never lock mailboxes.
SELECT mailbox.domain AS "domain!", (member.user_id = $2) AS "is_caller!"
FROM team_user member
JOIN LATERAL (
    SELECT lower(split_part(email_address, '@', 2)) AS domain
    FROM email_links
    WHERE macro_id = member.user_id AND is_primary
      AND deleting_at IS NULL AND disconnect_requested_at IS NULL
      AND NOT needs_reauth
    OFFSET 0
) mailbox ON TRUE
WHERE member.team_id = $1
