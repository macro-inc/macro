-- Keep foreign-key lock waits bounded on the existing User and team tables.
SET LOCAL lock_timeout = '5s';

-- Axiom: new identity is separate from stored macro| user ids and carries no credentials.
CREATE TABLE rox_identity_binding (
    macro_user_id TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    rox_account_id TEXT NOT NULL UNIQUE,
    handle TEXT NOT NULL UNIQUE,
    bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Local lifecycle state lets independent services refuse new work after FusionAuth soft deletion.
CREATE TABLE enterprise_member_state (
    macro_user_id TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    disabled_at TIMESTAMPTZ
);

-- A missing row preserves legacy behavior; a present array is exhaustive, including an empty one.
CREATE TABLE team_runtime_preset_allowlist (
    team_id UUID PRIMARY KEY REFERENCES team(id) ON DELETE CASCADE,
    preset_ids TEXT[] NOT NULL
);

-- Axiom: audit rows contain only actor, action, resource, result, and time plus their UUIDv7 key.
CREATE TABLE enterprise_audit (
    id UUID PRIMARY KEY,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN (
        'login', 'invite', 'share_link_create', 'mailbox_provision',
        'agent_session_start', 'member_disable', 'member_enable'
    )),
    resource_id TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE FUNCTION enterprise_audit_reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'enterprise_audit is append-only';
END;
$$;

CREATE TRIGGER enterprise_audit_append_only
BEFORE UPDATE OR DELETE ON enterprise_audit
FOR EACH ROW EXECUTE FUNCTION enterprise_audit_reject_mutation();
