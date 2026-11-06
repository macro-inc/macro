-- Consent is deliberately empty on rollout. A team enabling CRM previously
-- did not constitute individual permission to share a mailbox.
-- Fail closed for old readers/workers during rollout. Current code ignores
-- this retired switch; no company/contact records are removed.
UPDATE team_crm_settings SET crm_enabled = FALSE WHERE crm_enabled;

-- Rolling deployments can still receive writes from the old enable endpoint.
-- Keep its readers and workers disabled even if that endpoint is called again.
CREATE FUNCTION crm_disable_legacy_email_sharing() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.crm_enabled := FALSE;
    RETURN NEW;
END;
$$;

CREATE TRIGGER team_crm_settings_keep_email_sharing_disabled
BEFORE INSERT OR UPDATE OF crm_enabled ON team_crm_settings
FOR EACH ROW WHEN (NEW.crm_enabled)
EXECUTE FUNCTION crm_disable_legacy_email_sharing();

CREATE TABLE crm_email_consent (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    link_id UUID NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (user_id, team_id) REFERENCES team_user(user_id, team_id) ON DELETE CASCADE
);

CREATE TABLE crm_personal_email_blocklist (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    domain TEXT NOT NULL CHECK (domain = lower(domain) AND domain <> ''),
    PRIMARY KEY (team_id, user_id, domain),
    FOREIGN KEY (user_id, team_id) REFERENCES team_user(user_id, team_id) ON DELETE CASCADE
);

-- Committed with consent changes; publication can be retried after a crash.
CREATE TABLE crm_email_backfill_outbox (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (user_id, team_id) REFERENCES team_user(user_id, team_id) ON DELETE CASCADE
);

-- Shared by the CRM writer, email lists, and direct thread authorization.
CREATE FUNCTION crm_email_domain_blocked(crm_team UUID, crm_user TEXT, email_domain TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM (
            SELECT domain FROM crm_blocked_domains WHERE team_id = crm_team
            UNION ALL
            SELECT domain FROM crm_personal_email_blocklist
            WHERE team_id = crm_team AND user_id = crm_user
            UNION ALL
            SELECT d.domain FROM crm_domains d
            JOIN crm_companies c ON c.id = d.company_id
            WHERE d.team_id = crm_team AND NOT c.email_sync
        ) blocked
        WHERE lower(email_domain) = lower(blocked.domain)
           OR right(lower(email_domain), length(blocked.domain) + 1) = '.' || lower(blocked.domain)
    )
$$;

CREATE FUNCTION crm_email_thread_allowed(crm_team UUID, email_thread UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM email_threads t
        JOIN email_links l ON l.id = t.link_id AND l.is_primary AND l.deleting_at IS NULL
        JOIN crm_email_consent consent
          ON consent.team_id = crm_team AND consent.user_id = l.macro_id
         AND consent.link_id = l.id AND consent.enabled
        JOIN team_user member ON member.team_id = crm_team AND member.user_id = l.macro_id
        WHERE t.id = email_thread
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
