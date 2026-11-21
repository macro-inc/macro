                        AND EXISTS (
                            SELECT 1 FROM email_messages pm
                            WHERE pm.thread_id = t.id AND NOT pm.is_draft
                        )
                        AND NOT EXISTS (
                            SELECT 1 FROM (
                                SELECT lower(split_part(pc.email_address, '@', 2)) AS domain
                                FROM email_messages pm
                                JOIN email_contacts pc ON pc.id = pm.from_contact_id
                                WHERE pm.thread_id = t.id AND NOT pm.is_draft
                                UNION
                                SELECT lower(split_part(pc.email_address, '@', 2))
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
                            WHERE (suffix.suffix IN (SELECT suffix FROM team_blocked)) IS TRUE
                               OR ((cb.macro_id, suffix.suffix)
                                   IN (SELECT macro_id, suffix FROM personal_blocked)) IS TRUE
                        )
                  )
