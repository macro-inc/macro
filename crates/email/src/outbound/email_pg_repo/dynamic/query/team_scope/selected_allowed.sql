                        AND EXISTS (
                            SELECT 1 FROM email_messages pm
                            WHERE pm.thread_id = t.id AND NOT pm.is_draft
                        )
                        AND NOT EXISTS (
                            SELECT 1 FROM (
                                SELECT DISTINCT domain FROM crm_thread_participants
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
