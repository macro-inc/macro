                        AND (
                            cb.mode = 'all'
                            OR ((cb.link_id, t.id) IN (
                                SELECT link_id, thread_id FROM selected_threads
                            )) IS TRUE
                            OR EXISTS (
                                SELECT 1 FROM (
                                    SELECT lower(pc.email_address) AS address,
                                           lower(split_part(pc.email_address, '@', 2)) AS domain
                                    FROM email_messages pm
                                    JOIN email_contacts pc ON pc.id = pm.from_contact_id
                                    WHERE pm.thread_id = t.id AND NOT pm.is_draft
                                    UNION
                                    SELECT lower(pc.email_address), lower(split_part(pc.email_address, '@', 2))
                                    FROM email_messages pm
                                    JOIN email_message_recipients pr ON pr.message_id = pm.id
                                    JOIN email_contacts pc ON pc.id = pr.contact_id
                                    WHERE pm.thread_id = t.id AND NOT pm.is_draft
                                ) participant
                                CROSS JOIN LATERAL (
                                    SELECT participant.domain AS suffix
                                    UNION ALL
                                    SELECT substr(participant.domain, dot + 1)
                                    FROM generate_series(1, length(participant.domain)) dot
                                    WHERE substr(participant.domain, dot, 1) = '.'
                                ) suffix
                                WHERE ((cb.link_id, participant.address) IN (
                                    SELECT link_id, address FROM selected_addresses
                                )) IS TRUE
                                   OR EXISTS (
                                       SELECT 1 FROM (
                                           SELECT ids FROM selected_contacts
                                           WHERE link_id = cb.link_id OFFSET 0
                                       ) selected
                                       CROSS JOIN LATERAL unnest(selected.ids) target(contact_id)
                                       CROSS JOIN LATERAL (
                                           SELECT 1 FROM crm_contact_emails ce
                                           -- Equal row bounds use the composite
                                           -- key instead of a global address scan.
                                           WHERE (ce.contact_id, ce.email)
                                                 BETWEEN (target.contact_id, participant.address)
                                                     AND (target.contact_id, participant.address)
                                           OFFSET 0
                                       ) matched
                                   )
                                   OR ((cb.link_id, suffix.suffix) IN (
                                       SELECT link_id, domain FROM selected_domains
                                   )) IS TRUE
                                   OR EXISTS (
                                       SELECT 1 FROM (
                                           SELECT team_id, ids FROM selected_companies
                                           WHERE link_id = cb.link_id OFFSET 0
                                       ) selected
                                       CROSS JOIN LATERAL (
                                           SELECT company_id FROM crm_domains
                                           WHERE team_id = selected.team_id
                                             AND lower(domain) = suffix.suffix OFFSET 0
                                       ) matched
                                       WHERE matched.company_id = ANY(selected.ids)
                                   )
                            )
                        )
