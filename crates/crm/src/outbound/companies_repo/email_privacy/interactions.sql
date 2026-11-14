-- Set-based equivalent of filtering thread_interactions by
-- crm_email_thread_allowed($1, thread_id). Calling the function per thread
-- re-ran crm_email_domain_blocked, which scans the team's blocklists and every
-- company domain of the team, once for each participant of each thread. Keep
-- these predicates in sync with both functions; the privacy parity tests
-- compare this query against them.
WITH matching_messages AS (
    SELECT m.id, m.thread_id, m.is_sent, COALESCE(m.internal_date_ts, m.created_at) AS occurred_at
    FROM email_messages m
    JOIN email_message_recipients r ON r.message_id = m.id
    JOIN email_contacts ec ON ec.id = r.contact_id
    WHERE m.link_id = $2 AND ec.link_id = $2 AND m.is_sent AND NOT m.is_draft AND lower(ec.email_address) = $3
    UNION
    SELECT m.id, m.thread_id, m.is_sent, COALESCE(m.internal_date_ts, m.created_at)
    FROM email_messages m
    JOIN email_contacts ec ON ec.id = m.from_contact_id
    WHERE m.link_id = $2 AND ec.link_id = $2 AND NOT m.is_sent AND NOT m.is_draft AND lower(ec.email_address) = $3
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
    SELECT l.id AS link_id, l.macro_id AS owner
    FROM crm_email_consent consent
    JOIN email_links l
      ON l.id = consent.link_id AND l.macro_id = consent.user_id
     AND l.is_primary AND l.deleting_at IS NULL
    JOIN team_user member ON member.team_id = $1 AND member.user_id = l.macro_id
    WHERE consent.team_id = $1 AND consent.enabled
), thread_links AS MATERIALIZED (
    SELECT ti.*, t.link_id
    FROM thread_interactions ti
    JOIN email_threads t ON t.id = ti.thread_id
), contributed_threads AS MATERIALIZED (
    -- Every thread here has a non-draft message: the one that matched.
    SELECT tl.*, cm.owner
    FROM thread_links tl
    JOIN contributing_mailboxes cm ON cm.link_id = tl.link_id
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
    SELECT p.owner, p.contact_id, lower(split_part(ec.email_address, '@', 2)) AS domain
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
    JOIN crm_companies c ON c.id = d.company_id AND NOT c.email_sync
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
SELECT COALESCE(min(first_sent_at), min(first_at)) AS first_at,
       max(last_at) AS last_at, bool_or(is_sent) AS is_sent
FROM contributed_threads
WHERE thread_id NOT IN (SELECT thread_id FROM blocked_threads)
