-- Keep eligibility aligned with mailbox_domains.sql; only exclusion writes lock rows.
SELECT mailbox.domain AS "domain!",
       COALESCE(member.user_id = $2, FALSE) AS "is_caller!"
FROM team_user member
JOIN LATERAL (
    SELECT lower(split_part(email_address, '@', 2)) AS domain
    FROM email_links
    WHERE macro_id = member.user_id AND is_primary
      AND deleting_at IS NULL AND disconnect_requested_at IS NULL
      AND NOT needs_reauth
    OFFSET 0 FOR SHARE
) mailbox ON TRUE
WHERE member.team_id = $1 AND (NOT $3 OR member.user_id = $2)
FOR KEY SHARE OF member
