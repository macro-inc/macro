, candidate_addresses AS MATERIALIZED (
    SELECT link_id, address FROM selected_addresses
    UNION ALL
    SELECT selected.link_id, ce.email
    FROM selected_contacts selected
    CROSS JOIN LATERAL unnest(selected.ids) target(contact_id)
    CROSS JOIN LATERAL (
        SELECT email FROM crm_contact_emails WHERE contact_id = target.contact_id OFFSET 0
    ) ce
), candidate_domains AS MATERIALIZED (
    SELECT link_id, domain FROM selected_domains
    UNION ALL
    SELECT selected.link_id, lower(d.domain)
    FROM selected_companies selected
    CROSS JOIN LATERAL unnest(selected.ids) target(company_id)
    CROSS JOIN LATERAL (
        SELECT domain, team_id FROM crm_domains
        WHERE company_id = target.company_id OFFSET 0
    ) d
    WHERE d.team_id = selected.team_id
), domain_mailboxes AS MATERIALIZED (
    SELECT DISTINCT link_id FROM candidate_domains
), selected_email_contacts AS MATERIALIZED (
    SELECT a.link_id, ec.id
    FROM candidate_addresses a
    CROSS JOIN LATERAL (
        SELECT id FROM email_contacts
        WHERE link_id = a.link_id AND lower(email_address) = a.address OFFSET 0
    ) ec
    -- Duplicate contacts only inflate the conservative probe count; the page
    -- deduplicates thread IDs after the probe proves this stream is small.
    UNION ALL
    -- Stream each selected mailbox once; do not store its whole domain set
    -- before the capped positive-thread probe can read any candidates.
    SELECT mailbox.link_id, ec.id
    FROM domain_mailboxes mailbox
    CROSS JOIN LATERAL (
        SELECT id, lower(split_part(email_address, '@', 2)) AS domain
        FROM email_contacts WHERE link_id = mailbox.link_id OFFSET 0
    ) ec
    WHERE EXISTS (
        SELECT 1
        FROM (SELECT string_to_array(ec.domain, '.') AS labels OFFSET 0) parts
        CROSS JOIN LATERAL generate_subscripts(parts.labels, 1) label(index)
        WHERE ((mailbox.link_id, array_to_string(parts.labels[label.index:], '.')) IN (
            SELECT link_id, domain FROM candidate_domains
        )) IS TRUE
    )
)
