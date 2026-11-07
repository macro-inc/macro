                  AND EXISTS (
                      WITH crm_thread_participants AS MATERIALIZED (
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
                      )
                      SELECT 1 FROM contributing cb
                      WHERE cb.link_id = t.link_id
                        AND NOT crm_email_thread_excluded(cb.team_id, cb.macro_id, cb.link_id, t.id)
