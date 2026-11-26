-- Legacy rows remain NULL until the owner-bound policy repository initializes
-- them. No backfill, consent change, volatile default or email-path work.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_email_consent ADD COLUMN consent_incarnation UUID;

CREATE FUNCTION crm_guard_email_consent_incarnation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Modern initialization is a disabled row, never an implicit grant.
        IF NEW.enabled OR NEW.selected_enabled OR NEW.mode <> 'all'
           OR NEW.active_rule_revision IS NOT NULL OR NEW.policy_version <> 0 THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = 'Initialize contribution identity before granting consent';
        END IF;
    ELSE
        IF (NEW.team_id, NEW.user_id) IS DISTINCT FROM (OLD.team_id, OLD.user_id) THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = 'Contribution ownership is immutable';
        END IF;
        IF OLD.consent_incarnation IS NOT NULL
           AND NEW.consent_incarnation IS DISTINCT FROM OLD.consent_incarnation THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = 'Contribution incarnation is immutable';
        END IF;
        IF OLD.consent_incarnation IS NULL AND NEW.consent_incarnation IS NOT NULL
           AND (NEW.link_id, NEW.mode, NEW.enabled, NEW.selected_enabled,
                NEW.active_rule_revision, NEW.policy_version)
               IS DISTINCT FROM
               (OLD.link_id, OLD.mode, OLD.enabled, OLD.selected_enabled,
                OLD.active_rule_revision, OLD.policy_version) THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = 'Initialize contribution identity without changing consent';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Incarnations are fresh UUIDv7s from the server, never a client-supplied token.
-- Old INSERTs omit the column and skip the function; old UPDATEs never name it.
CREATE TRIGGER crm_email_consent_15_incarnation_insert
BEFORE INSERT ON crm_email_consent
FOR EACH ROW WHEN (NEW.consent_incarnation IS NOT NULL)
EXECUTE FUNCTION crm_guard_email_consent_incarnation();
CREATE TRIGGER crm_email_consent_15_incarnation_update
BEFORE UPDATE OF team_id, user_id, consent_incarnation ON crm_email_consent
FOR EACH ROW EXECUTE FUNCTION crm_guard_email_consent_incarnation();
