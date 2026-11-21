SELECT EXISTS (
    SELECT 1 FROM email_links l
    -- Resolve the mailbox first; stale plans must not walk its whole team.
    JOIN LATERAL (
        SELECT user_id FROM team_user
        WHERE user_id = l.macro_id AND team_id = $1
        OFFSET 0
    ) member ON TRUE
    JOIN LATERAL (
        SELECT user_id, enabled, selected_enabled, consent_incarnation, mode, policy_version
        FROM crm_email_consent
        WHERE team_id = $1 AND user_id = l.macro_id AND link_id = l.id
        OFFSET 0
    ) c ON TRUE
    WHERE l.id = $2 AND l.is_primary AND l.deleting_at IS NULL
      AND l.disconnect_requested_at IS NULL AND NOT l.needs_reauth
      AND (c.enabled OR c.selected_enabled)
      AND (NOT $4::boolean OR (
          c.consent_incarnation IS NOT DISTINCT FROM $5
          AND (($5::uuid IS NULL AND c.mode = 'all' AND c.enabled)
               OR c.policy_version = $6)
      ))
      AND NOT crm_email_domain_blocked($1, c.user_id, split_part($3, '@', 2))
) AS "admitted!"
