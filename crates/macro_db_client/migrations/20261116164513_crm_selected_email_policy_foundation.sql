-- Dormant storage only: no existing consent changes and no selected activation API.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE crm_email_rule_revisions (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    revision BIGINT NOT NULL CHECK (revision > 0),
    link_id UUID NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
    definition JSONB NOT NULL CHECK (
        jsonb_typeof(definition) = 'object'
        AND octet_length(definition::text) <= 65536
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id, revision),
    UNIQUE (team_id, user_id, link_id, revision),
    FOREIGN KEY (user_id, team_id) REFERENCES team_user(user_id, team_id) ON DELETE CASCADE
);
-- Mailbox deletion must not scan other members' history.
CREATE INDEX crm_email_rule_revisions_link ON crm_email_rule_revisions(link_id);

-- Contact/company IDs are live references, not expanded address/domain snapshots.
-- They deliberately have no entity FK: deleting a source makes the rule match
-- nothing without rewriting the immutable rule revision or retargeting by name.
CREATE TABLE crm_email_rule_threads (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    revision BIGINT NOT NULL,
    thread_id UUID NOT NULL,
    PRIMARY KEY (team_id, user_id, revision, thread_id),
    FOREIGN KEY (team_id, user_id, revision)
        REFERENCES crm_email_rule_revisions(team_id, user_id, revision) ON DELETE CASCADE
);
CREATE TABLE crm_email_rule_addresses (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    revision BIGINT NOT NULL,
    address TEXT NOT NULL CHECK (
        address = lower(btrim(address)) AND length(address) BETWEEN 3 AND 254
        AND address ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    ),
    PRIMARY KEY (team_id, user_id, revision, address),
    FOREIGN KEY (team_id, user_id, revision)
        REFERENCES crm_email_rule_revisions(team_id, user_id, revision) ON DELETE CASCADE
);
CREATE TABLE crm_email_rule_contacts (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    revision BIGINT NOT NULL,
    contact_id UUID NOT NULL,
    PRIMARY KEY (team_id, user_id, revision, contact_id),
    FOREIGN KEY (team_id, user_id, revision)
        REFERENCES crm_email_rule_revisions(team_id, user_id, revision) ON DELETE CASCADE
);
CREATE TABLE crm_email_rule_domains (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    revision BIGINT NOT NULL,
    domain TEXT NOT NULL CHECK (
        domain = lower(btrim(domain)) AND length(domain) BETWEEN 3 AND 253
        AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    ),
    PRIMARY KEY (team_id, user_id, revision, domain),
    FOREIGN KEY (team_id, user_id, revision)
        REFERENCES crm_email_rule_revisions(team_id, user_id, revision) ON DELETE CASCADE
);
CREATE TABLE crm_email_rule_companies (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    revision BIGINT NOT NULL,
    company_id UUID NOT NULL,
    PRIMARY KEY (team_id, user_id, revision, company_id),
    FOREIGN KEY (team_id, user_id, revision)
        REFERENCES crm_email_rule_revisions(team_id, user_id, revision) ON DELETE CASCADE
);

CREATE TABLE crm_email_policy_audit (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    event_id UUID NOT NULL,
    link_id UUID NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    policy_version BIGINT NOT NULL CHECK (policy_version >= 0),
    action TEXT NOT NULL CHECK (action IN (
        'rules_activated', 'all_mail_enabled', 'withdrawn', 'mailbox_revoked', 'live_targets_changed'
    )),
    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('member', 'agent', 'api', 'system')),
    agent_id UUID,
    agent_session_id UUID,
    previous_revision BIGINT CHECK (previous_revision > 0),
    next_revision BIGINT CHECK (next_revision > 0),
    details JSONB NOT NULL DEFAULT '{}' CHECK (
        jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 65536
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id, event_id),
    FOREIGN KEY (user_id, team_id) REFERENCES team_user(user_id, team_id) ON DELETE CASCADE,
    CHECK (actor_kind = 'agent' OR (agent_id IS NULL AND agent_session_id IS NULL))
);
CREATE INDEX crm_email_policy_audit_link ON crm_email_policy_audit(link_id);

ALTER TABLE crm_email_consent
    ADD COLUMN mode TEXT NOT NULL DEFAULT 'all' CHECK (mode IN ('all', 'selected')),
    ADD COLUMN selected_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN active_rule_revision BIGINT,
    ADD COLUMN policy_version BIGINT NOT NULL DEFAULT 0 CHECK (policy_version >= 0),
    ADD CONSTRAINT crm_email_consent_all_grant CHECK (NOT enabled OR mode = 'all'),
    ADD CONSTRAINT crm_email_consent_selected_grant CHECK (
        NOT selected_enabled OR (mode = 'selected' AND active_rule_revision IS NOT NULL)
    ),
    ADD CONSTRAINT crm_email_consent_selected_revision CHECK (
        active_rule_revision IS NULL OR mode = 'selected'
    ),
    ADD CONSTRAINT crm_email_consent_rule_owner FOREIGN KEY (
        team_id, user_id, link_id, active_rule_revision
    ) REFERENCES crm_email_rule_revisions(team_id, user_id, link_id, revision);

-- Old upserts cannot turn a selected grant into an all-mail grant. Old false
-- writes revoke selected too, including a no-op UPDATE of the legacy false bit.
CREATE FUNCTION crm_guard_legacy_email_consent() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.enabled AND NEW.mode = 'selected' THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Review current contribution settings before enabling all mail';
    END IF;
    IF NOT NEW.enabled THEN
        NEW.selected_enabled := FALSE;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.link_id IS DISTINCT FROM OLD.link_id THEN
        NEW.active_rule_revision := NULL;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER crm_email_consent_10_legacy
BEFORE INSERT OR UPDATE OF enabled ON crm_email_consent
FOR EACH ROW EXECUTE FUNCTION crm_guard_legacy_email_consent();

-- A database-owned version also fences a new rule writer against old clients
-- and mailbox lifecycle revocation, whose statements know nothing about CAS.
CREATE FUNCTION crm_version_email_consent() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.policy_version := OLD.policy_version;
    IF (NEW.link_id, NEW.mode, NEW.enabled, NEW.selected_enabled, NEW.active_rule_revision)
        IS DISTINCT FROM
       (OLD.link_id, OLD.mode, OLD.enabled, OLD.selected_enabled, OLD.active_rule_revision) THEN
        NEW.policy_version := OLD.policy_version + 1;
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER crm_email_consent_20_version
BEFORE UPDATE ON crm_email_consent
FOR EACH ROW EXECUTE FUNCTION crm_version_email_consent();
