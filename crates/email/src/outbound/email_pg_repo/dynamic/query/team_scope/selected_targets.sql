, selected_threads AS MATERIALIZED (
    SELECT cb.link_id, r.thread_id
    FROM contributing cb
    CROSS JOIN LATERAL (
        SELECT thread_id FROM crm_email_rule_threads
        WHERE team_id = cb.team_id AND user_id = cb.macro_id
          AND revision = cb.active_rule_revision OFFSET 0
    ) r
    WHERE cb.mode = 'selected'
), selected_addresses AS MATERIALIZED (
    SELECT cb.link_id, r.address
    FROM contributing cb
    CROSS JOIN LATERAL (
        SELECT address FROM crm_email_rule_addresses
        WHERE team_id = cb.team_id AND user_id = cb.macro_id
          AND revision = cb.active_rule_revision OFFSET 0
    ) r
    WHERE cb.mode = 'selected'
), selected_contacts AS MATERIALIZED (
    -- Keep the per-thread predicate bounded by rule IDs, independently of
    -- how many addresses a live contact acquires.
    SELECT cb.link_id, array_agg(ct.id) AS ids
    FROM contributing cb
    CROSS JOIN LATERAL (
        SELECT contact_id FROM crm_email_rule_contacts
        WHERE team_id = cb.team_id AND user_id = cb.macro_id
          AND revision = cb.active_rule_revision OFFSET 0
    ) r
    CROSS JOIN LATERAL (
        SELECT ct.id FROM crm_contacts ct
        LEFT JOIN crm_companies co ON co.id = ct.company_id
        WHERE ct.id = r.contact_id AND ct.team_id = cb.team_id
          AND (NOT ct.hidden OR cb.team_role <> 'member')
          AND (ct.company_id IS NULL OR
               (co.team_id = cb.team_id AND (NOT co.hidden OR cb.team_role <> 'member')))
        OFFSET 0
    ) ct
    WHERE cb.mode = 'selected'
    GROUP BY cb.link_id
), selected_domains AS MATERIALIZED (
    SELECT cb.link_id, r.domain
    FROM contributing cb
    CROSS JOIN LATERAL (
        SELECT domain FROM crm_email_rule_domains
        WHERE team_id = cb.team_id AND user_id = cb.macro_id
          AND revision = cb.active_rule_revision OFFSET 0
    ) r
    WHERE cb.mode = 'selected'
), selected_companies AS MATERIALIZED (
    SELECT cb.link_id, cb.team_id, array_agg(co.id) AS ids
    FROM contributing cb
    CROSS JOIN LATERAL (
        SELECT company_id FROM crm_email_rule_companies
        WHERE team_id = cb.team_id AND user_id = cb.macro_id
          AND revision = cb.active_rule_revision OFFSET 0
    ) r
    CROSS JOIN LATERAL (
        SELECT id FROM crm_companies
        WHERE id = r.company_id AND team_id = cb.team_id
          AND (NOT hidden OR cb.team_role <> 'member') OFFSET 0
    ) co
    WHERE cb.mode = 'selected'
    GROUP BY cb.link_id, cb.team_id
)
