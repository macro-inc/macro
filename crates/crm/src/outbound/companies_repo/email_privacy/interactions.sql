-- Set-based equivalent of filtering thread_interactions by
-- crm_email_thread_allowed($1, thread_id). Calling the function per thread
-- re-ran crm_email_domain_blocked, which scans the team's blocklists and every
-- company domain of the team, once for each participant of each thread. Keep
-- these predicates in sync with both functions; the privacy parity tests
-- compare this query against them.
-- Mail the provider no longer has (`provider_missing`: deleted at Outlook)
-- is no interaction, as a Gmail deletion removes the row.
WITH matching_messages AS MATERIALIZED (
    SELECT m.id, m.thread_id, m.is_sent, COALESCE(m.internal_date_ts, m.created_at) AS occurred_at, ec.id AS contact_id
    FROM email_messages m
    JOIN email_message_recipients r ON r.message_id = m.id
    JOIN email_contacts ec ON ec.id = r.contact_id
    WHERE m.link_id = $2 AND ec.link_id = $2 AND m.is_sent AND NOT m.is_draft AND lower(ec.email_address) = $3
      AND NOT COALESCE((m.mailbox_state->>'provider_missing')::boolean, false)
    UNION
    SELECT m.id, m.thread_id, m.is_sent, COALESCE(m.internal_date_ts, m.created_at), ec.id
    FROM email_messages m
    JOIN email_contacts ec ON ec.id = m.from_contact_id
    WHERE m.link_id = $2 AND ec.link_id = $2 AND NOT m.is_sent AND NOT m.is_draft AND lower(ec.email_address) = $3
      AND NOT COALESCE((m.mailbox_state->>'provider_missing')::boolean, false)
), thread_interactions AS MATERIALIZED (
    SELECT thread_id,
           min(occurred_at) FILTER (WHERE is_sent) AS first_sent_at,
           min(occurred_at) AS first_at,
           max(occurred_at) AS last_at,
           bool_or(is_sent) AS is_sent
    FROM matching_messages
    GROUP BY thread_id
), contributing_mailboxes AS MATERIALIZED (
    -- The mailbox conditions depend only on the thread's link.
    SELECT consent.team_id, l.id AS link_id, l.macro_id AS owner,
           consent.mode, consent.active_rule_revision, member.team_role
    FROM crm_email_consent consent
    JOIN email_links l
      ON l.id = consent.link_id AND l.macro_id = consent.user_id
     AND l.is_primary AND l.deleting_at IS NULL
    JOIN team_user member ON member.team_id = $1 AND member.user_id = l.macro_id
    WHERE consent.team_id = $1 AND consent.link_id = $2
      AND (consent.enabled OR consent.selected_enabled)
), thread_links AS MATERIALIZED (
    SELECT ti.*, t.link_id
    FROM thread_interactions ti
    JOIN email_threads t ON t.id = ti.thread_id
), contributed_threads AS MATERIALIZED (
    -- Every thread here has a non-draft message: the one that matched.
    SELECT tl.*, cm.owner, cm.mode
    FROM thread_links tl
    JOIN contributing_mailboxes cm ON cm.link_id = tl.link_id
    WHERE NOT EXISTS (
        SELECT 1 FROM crm_email_thread_exclusions e
        WHERE e.team_id = $1 AND e.user_id = cm.owner
          AND e.thread_id = tl.thread_id AND e.link_id = tl.link_id
    )
), thread_messages AS MATERIALIZED (
    SELECT ct.thread_id, ct.owner, m.id, m.from_contact_id
    FROM contributed_threads ct
    JOIN email_messages m ON m.thread_id = ct.thread_id AND NOT m.is_draft
), participants AS MATERIALIZED (
    SELECT thread_id, owner, from_contact_id AS contact_id
    FROM thread_messages WHERE from_contact_id IS NOT NULL
    UNION
    SELECT tm.thread_id, tm.owner, r.contact_id
    FROM thread_messages tm
    JOIN email_message_recipients r ON r.message_id = tm.id
), participant_domains AS MATERIALIZED (
    SELECT p.owner, p.contact_id, lower(ec.email_address) AS address,
           lower(split_part(ec.email_address, '@', 2)) AS domain
    FROM (SELECT DISTINCT owner, contact_id FROM participants) p
    JOIN email_contacts ec ON ec.id = p.contact_id
), domain_suffixes AS MATERIALIZED (
    -- A blocked domain matches itself and every subdomain: the participant
    -- domain or any suffix of it that follows a dot.
    SELECT pd.domain, s.suffix
    FROM (SELECT DISTINCT domain FROM participant_domains) pd
    CROSS JOIN LATERAL (
        SELECT pd.domain AS suffix
        UNION
        SELECT substr(pd.domain, i + 1)
        FROM generate_series(1, length(pd.domain)) i
        WHERE substr(pd.domain, i, 1) = '.'
    ) s
), owners AS MATERIALIZED (
    SELECT DISTINCT owner FROM contributed_threads
), blocked_suffixes AS MATERIALIZED (
    SELECT o.owner, lower(b.domain) AS suffix
    FROM owners o
    JOIN crm_personal_email_blocklist b ON b.team_id = $1 AND b.user_id = o.owner
    UNION
    SELECT o.owner, lower(b.domain)
    FROM owners o CROSS JOIN crm_blocked_domains b
    WHERE b.team_id = $1
    UNION
    -- Look up only the suffixes in play rather than every company domain.
    SELECT o.owner, lower(d.domain)
    FROM owners o
    CROSS JOIN (SELECT DISTINCT suffix FROM domain_suffixes) s
    JOIN crm_domains d ON d.team_id = $1 AND lower(d.domain) = s.suffix
    JOIN crm_companies c ON c.id = d.company_id AND c.team_id = $1 AND NOT c.email_sync
), blocked_owner_domains AS MATERIALIZED (
    SELECT DISTINCT b.owner, s.domain
    FROM blocked_suffixes b
    JOIN domain_suffixes s ON s.suffix = b.suffix
), blocked_threads AS MATERIALIZED (
    SELECT DISTINCT p.thread_id
    FROM blocked_owner_domains b
    JOIN participant_domains pd ON pd.owner = b.owner AND pd.domain = b.domain
    JOIN participants p ON p.owner = pd.owner AND p.contact_id = pd.contact_id
)
, selected_threads AS MATERIALIZED (
    SELECT cb.owner, r.thread_id
    FROM contributing_mailboxes cb
    CROSS JOIN LATERAL (
        SELECT thread_id FROM crm_email_rule_threads
        WHERE team_id = cb.team_id AND user_id = cb.owner
          AND revision = cb.active_rule_revision
        OFFSET 0
    ) r
    WHERE cb.mode = 'selected'
), selected_addresses AS MATERIALIZED (
    SELECT cb.owner, r.address
    FROM contributing_mailboxes cb
    CROSS JOIN LATERAL (
        SELECT address FROM crm_email_rule_addresses
        WHERE team_id = cb.team_id AND user_id = cb.owner
          AND revision = cb.active_rule_revision
        OFFSET 0
    ) r
    WHERE cb.mode = 'selected'
    UNION
    SELECT cb.owner, ce.email
    FROM contributing_mailboxes cb
    CROSS JOIN LATERAL (
        SELECT contact_id FROM crm_email_rule_contacts
        WHERE team_id = cb.team_id AND user_id = cb.owner
          AND revision = cb.active_rule_revision
        OFFSET 0
    ) r
    JOIN crm_contacts ct ON ct.id = r.contact_id AND ct.team_id = cb.team_id
    LEFT JOIN crm_companies co ON co.id = ct.company_id
    CROSS JOIN LATERAL (
        SELECT email FROM crm_contact_emails WHERE contact_id = ct.id OFFSET 0
    ) ce
    WHERE cb.mode = 'selected'
      AND (NOT ct.hidden OR cb.team_role <> 'member')
      AND (ct.company_id IS NULL OR
           (co.team_id = cb.team_id AND (NOT co.hidden OR cb.team_role <> 'member')))
), selected_domains AS MATERIALIZED (
    SELECT cb.owner, r.domain
    FROM contributing_mailboxes cb
    CROSS JOIN LATERAL (
        SELECT domain FROM crm_email_rule_domains
        WHERE team_id = cb.team_id AND user_id = cb.owner
          AND revision = cb.active_rule_revision
        OFFSET 0
    ) r
    WHERE cb.mode = 'selected'
    UNION
    SELECT cb.owner, lower(d.domain)
    FROM contributing_mailboxes cb
    CROSS JOIN LATERAL (
        SELECT company_id FROM crm_email_rule_companies
        WHERE team_id = cb.team_id AND user_id = cb.owner
          AND revision = cb.active_rule_revision
        OFFSET 0
    ) r
    JOIN crm_companies co ON co.id = r.company_id AND co.team_id = cb.team_id
    CROSS JOIN LATERAL (
        SELECT domain, team_id FROM crm_domains
        WHERE company_id = co.id OFFSET 0
    ) d
    WHERE cb.mode = 'selected' AND d.team_id = cb.team_id
      AND (NOT co.hidden OR cb.team_role <> 'member')
)

, selected_participants AS MATERIALIZED (
    SELECT pd.owner, pd.contact_id
    FROM participant_domains pd
    JOIN selected_addresses a ON a.owner = pd.owner AND a.address = pd.address
    UNION
    SELECT pd.owner, pd.contact_id
    FROM participant_domains pd
    JOIN domain_suffixes s ON s.domain = pd.domain
    JOIN selected_domains d ON d.owner = pd.owner AND d.domain = s.suffix
), included_threads AS MATERIALIZED (
    SELECT thread_id FROM contributed_threads WHERE mode = 'all'
    UNION
    SELECT ct.thread_id FROM contributed_threads ct
    JOIN selected_threads r ON r.owner = ct.owner AND r.thread_id = ct.thread_id
    UNION
    SELECT p.thread_id FROM participants p
    JOIN selected_participants s ON s.owner = p.owner AND s.contact_id = p.contact_id
), eligible_threads AS MATERIALIZED (
    SELECT thread_id FROM contributed_threads
    -- Preserve hashed membership even when estimates predict few matches;
    -- nested-loop semi-joins can become quadratic for an included history.
    WHERE (thread_id IN (SELECT thread_id FROM included_threads)) IS TRUE
      AND thread_id NOT IN (SELECT thread_id FROM blocked_threads)
), eligible_messages AS MATERIALIZED (
    SELECT m.* FROM matching_messages m
    WHERE (m.thread_id IN (SELECT thread_id FROM eligible_threads)) IS TRUE
)
SELECT first_message.occurred_at AS first_at,
       last_message.occurred_at AS last_at,
       first_message.is_sent AS is_sent,
       first_message.id AS first_message_id,
       first_message.thread_id AS first_thread_id,
       first_message.contact_id AS first_contact_id,
       last_message.id AS last_message_id,
       last_message.thread_id AS last_thread_id,
       last_message.contact_id AS last_contact_id,
       last_message.is_sent AS last_is_sent
FROM (VALUES (1)) singleton(dummy)
LEFT JOIN LATERAL (
    -- The earliest sent message supplies both first_at and is_sent; fall
    -- back to the earliest received message when there is no sent history.
    SELECT * FROM eligible_messages
    ORDER BY is_sent DESC, occurred_at, id, contact_id
    LIMIT 1
) first_message ON TRUE
LEFT JOIN LATERAL (
    SELECT * FROM eligible_messages
    ORDER BY occurred_at DESC, id, contact_id
    LIMIT 1
) last_message ON TRUE
