SET LOCAL lock_timeout = '5s';

-- Exceptions are scoped to one member's mailbox-local copy. Target-specific
-- tables retain foreign keys when label/folder exclusions are added later.
CREATE TABLE crm_email_thread_exclusions (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    link_id UUID NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, user_id, thread_id),
    FOREIGN KEY (user_id, team_id) REFERENCES team_user(user_id, team_id) ON DELETE CASCADE
);

-- Cascade lookups start from the deleted mailbox/thread, not a team.
CREATE INDEX crm_email_thread_exclusions_link ON crm_email_thread_exclusions (link_id);
CREATE INDEX crm_email_thread_exclusions_thread ON crm_email_thread_exclusions (thread_id);

-- Keep private-thread exceptions independent of domain rules and consent, so
-- selective contribution can apply the same veto after an inclusion matches.
CREATE FUNCTION crm_email_thread_excluded(crm_team UUID, crm_user TEXT, mailbox UUID, email_thread UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM crm_email_thread_exclusions e
        WHERE e.team_id = crm_team AND e.user_id = crm_user
          AND e.thread_id = email_thread AND e.link_id = mailbox
    )
$$;

CREATE OR REPLACE FUNCTION crm_email_thread_allowed(crm_team UUID, email_thread UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM email_threads t
        JOIN email_links l ON l.id = t.link_id AND l.is_primary AND l.deleting_at IS NULL
        JOIN crm_email_consent consent
          ON consent.team_id = crm_team AND consent.user_id = l.macro_id
         AND consent.link_id = l.id AND consent.enabled
        JOIN team_user member ON member.team_id = crm_team AND member.user_id = l.macro_id
        WHERE t.id = email_thread
          AND NOT crm_email_thread_excluded(crm_team, l.macro_id, l.id, t.id)
          AND EXISTS (
              SELECT 1 FROM email_messages m
              WHERE m.thread_id = t.id AND NOT m.is_draft
          )
          AND NOT EXISTS (
              SELECT 1 FROM (
                  SELECT ec.email_address FROM email_messages m
                  JOIN email_contacts ec ON ec.id = m.from_contact_id
                  WHERE m.thread_id = t.id AND NOT m.is_draft
                  UNION
                  SELECT ec.email_address FROM email_messages m
                  JOIN email_message_recipients r ON r.message_id = m.id
                  JOIN email_contacts ec ON ec.id = r.contact_id
                  WHERE m.thread_id = t.id AND NOT m.is_draft
              ) participant
              WHERE crm_email_domain_blocked(crm_team, l.macro_id, split_part(participant.email_address, '@', 2))
          )
    )
$$;
