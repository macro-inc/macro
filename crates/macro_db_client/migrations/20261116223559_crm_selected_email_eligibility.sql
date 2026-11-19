-- The function deploys before the inline Team and ingestion readers. No
-- selected activator exists yet: refuse a rollout that violates that premise.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM crm_email_consent WHERE mode = 'selected' OR selected_enabled) THEN
        RAISE EXCEPTION 'selected consent exists before compatible eligibility readers';
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION crm_email_thread_allowed(crm_team UUID, email_thread UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    WITH policy AS MATERIALIZED (
        SELECT t.id AS thread_id, l.id AS link_id, l.macro_id AS user_id,
               consent.mode, consent.active_rule_revision, member.team_role
        FROM email_threads t
        JOIN email_links l ON l.id = t.link_id AND l.is_primary AND l.deleting_at IS NULL
        JOIN crm_email_consent consent
          ON consent.team_id = crm_team AND consent.user_id = l.macro_id
         AND consent.link_id = l.id AND (consent.enabled OR consent.selected_enabled)
        JOIN team_user member ON member.team_id = crm_team AND member.user_id = l.macro_id
        WHERE t.id = email_thread
          AND NOT crm_email_thread_excluded(crm_team, l.macro_id, l.id, t.id)
    ), participants AS MATERIALIZED (
        SELECT lower(ec.email_address) AS address,
               lower(split_part(ec.email_address, '@', 2)) AS domain
        FROM policy p
        JOIN email_messages m ON m.thread_id = p.thread_id AND NOT m.is_draft
        JOIN email_contacts ec ON ec.id = m.from_contact_id
        UNION
        SELECT lower(ec.email_address), lower(split_part(ec.email_address, '@', 2))
        FROM policy p
        JOIN email_messages m ON m.thread_id = p.thread_id AND NOT m.is_draft
        JOIN email_message_recipients r ON r.message_id = m.id
        JOIN email_contacts ec ON ec.id = r.contact_id
    ), contact_targets AS MATERIALIZED (
        -- Resolve at most the policy's contact IDs, not every address held
        -- by those contacts. Participant probes use (contact_id, email).
        SELECT ct.id
        FROM policy p
        CROSS JOIN LATERAL (
            SELECT contact_id FROM crm_email_rule_contacts
            WHERE team_id = crm_team AND user_id = p.user_id
              AND revision = p.active_rule_revision OFFSET 0
        ) r
        CROSS JOIN LATERAL (
            SELECT id, team_id, company_id, hidden FROM crm_contacts
            WHERE id = r.contact_id OFFSET 0
        ) ct
        LEFT JOIN LATERAL (
            SELECT team_id, hidden FROM crm_companies
            WHERE id = ct.company_id OFFSET 0
        ) co ON TRUE
        WHERE p.mode = 'selected' AND ct.team_id = crm_team
          AND (NOT ct.hidden OR p.team_role <> 'member')
          AND (ct.company_id IS NULL OR
               (co.team_id = crm_team AND (NOT co.hidden OR p.team_role <> 'member')))
    ), company_targets AS MATERIALIZED (
        SELECT co.id
        FROM policy p
        CROSS JOIN LATERAL (
            SELECT company_id FROM crm_email_rule_companies
            WHERE team_id = crm_team AND user_id = p.user_id
              AND revision = p.active_rule_revision OFFSET 0
        ) r
        CROSS JOIN LATERAL (
            SELECT id, team_id, hidden FROM crm_companies
            WHERE id = r.company_id OFFSET 0
        ) co
        WHERE p.mode = 'selected' AND co.team_id = crm_team
          AND (NOT co.hidden OR p.team_role <> 'member')
    )
    SELECT EXISTS (
        SELECT 1 FROM policy p
        WHERE EXISTS (
            SELECT 1 FROM email_messages m
            WHERE m.thread_id = p.thread_id AND NOT m.is_draft
        )
          AND (
              p.mode = 'all'
              OR EXISTS (
                  SELECT 1 FROM crm_email_rule_threads r
                  WHERE r.team_id = crm_team AND r.user_id = p.user_id
                    AND r.revision = p.active_rule_revision AND r.thread_id = p.thread_id
              )
              OR EXISTS (
                  SELECT 1 FROM participants participant
                  WHERE EXISTS (
                      SELECT 1 FROM crm_email_rule_addresses r
                      WHERE r.team_id = crm_team AND r.user_id = p.user_id
                        AND r.revision = p.active_rule_revision AND r.address = participant.address
                  )
                     OR EXISTS (
                         SELECT 1 FROM contact_targets target
                         CROSS JOIN LATERAL (
                             SELECT 1 FROM crm_contact_emails ce
                             -- Equal row bounds keep this a composite-key
                             -- probe; the global email index can fan out
                             -- across unrelated teams with the same address.
                             WHERE (ce.contact_id, ce.email)
                                   BETWEEN (target.id, participant.address)
                                       AND (target.id, participant.address)
                             OFFSET 0
                         ) matched
                     )
                     OR EXISTS (
                         SELECT 1 FROM (
                             SELECT participant.domain AS suffix
                             UNION ALL
                             SELECT substr(participant.domain, dot + 1)
                             FROM generate_series(1, length(participant.domain)) dot
                             WHERE substr(participant.domain, dot, 1) = '.'
                         ) suffix
                         WHERE EXISTS (
                             SELECT 1 FROM crm_email_rule_domains r
                             WHERE r.team_id = crm_team AND r.user_id = p.user_id
                               AND r.revision = p.active_rule_revision AND r.domain = suffix.suffix
                         )
                            OR EXISTS (
                                SELECT 1 FROM crm_domains d
                                WHERE d.team_id = crm_team AND lower(d.domain) = suffix.suffix
                                  AND d.company_id = ANY(ARRAY(SELECT id FROM company_targets))
                            )
                     )
              )
          )
          AND NOT EXISTS (
              SELECT 1 FROM participants participant
              WHERE crm_email_domain_blocked(crm_team, p.user_id, participant.domain)
          )
    )
$$;
