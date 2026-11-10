-- Macro computers: team-owned hosted VMs running macrod, owned by
-- crates/hosted_runtimes, plus what they need from existing tables.

SET LOCAL lock_timeout = '5s';

-- Existing tables: additive, metadata-only changes (nullable columns or
-- constant defaults; no rewrite).

-- What a harness's machine can do, reported by macrod after it connects,
-- e.g. {"screen": true}. `computer_id` is the Macro computer it runs on; null
-- for a machine the user paired. No foreign key: computers outlive
-- soft-deleted harness rows. `claude_mode` is how Claude Code on a computer
-- is paid for; the sign-in columns are set with 'own_account' and cleared on
-- sign-out. `capabilities_reported_at` is when macrod last reported, so a
-- report older than a sign-in is not taken for its outcome.
ALTER TABLE public.harnesses
    ADD COLUMN capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN computer_id uuid,
    ADD COLUMN claude_mode text NOT NULL DEFAULT 'macro_credits'
        CHECK (claude_mode IN ('macro_credits', 'own_account')),
    ADD COLUMN claude_signed_in_by text,
    ADD COLUMN claude_signed_in_at timestamptz,
    ADD COLUMN capabilities_reported_at timestamptz;

-- Deleting a Macro computer's harness does not unbind its agents: the
-- computer's release deletes them right after, finding them by that binding,
-- so a retried release still can. Other harnesses keep unbinding.
CREATE OR REPLACE FUNCTION unbind_agents_from_deleted_harness()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        IF NEW.computer_id IS NULL THEN
            UPDATE agent_configs SET harness_id = NULL WHERE harness_id = NEW.id;
        END IF;
        RETURN NULL;
    END;
$$;

-- New tables.

-- The model configuration each paired runtime last reported, so its agents
-- stay editable while the machine is off. Owned by agent_harness_service.
CREATE TABLE harness_known_models (
    harness_id UUID PRIMARY KEY REFERENCES harnesses (id) ON DELETE CASCADE,
    options JSONB NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL
);

-- Billing receipts kept independently of team/subscription deletion, so a
-- delayed purchase replay cannot charge twice. Owned by crates/teams.
CREATE TABLE subscription_item_change (
    idempotency_key TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    path TEXT NOT NULL,
    request JSONB NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'pending'
        CHECK (outcome IN ('pending', 'succeeded', 'payment_failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX subscription_item_change_pending_idx
    ON subscription_item_change (subscription_id) WHERE outcome = 'pending';

-- A fleet host, counted in size units (one unit = 8 GB RAM).
CREATE TABLE hosted_runtime_host (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    awake_capacity_units INTEGER NOT NULL CHECK (awake_capacity_units >= 0),
    sold_capacity_units INTEGER NOT NULL CHECK (sold_capacity_units >= 0),
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One computer. `state` is the lifecycle's ComputerState; `host_id`, `awake`
-- and `holds_units` mirror it for capacity queries and are written with it.
-- The resources, catalog entry and price are snapshotted at purchase; comped
-- computers have no price. `created_by` is RESTRICTed so enrollment and
-- billing attribution survive until the computer or team is deleted.
-- `image` is what the root disk was last built from and `previous_image`
-- the rollback target, both null until the first creation finishes. The
-- claude_notice_* columns are the last Claude sign-in expiry notice sent.
-- Bots are soft-deleted, so `default_agent_id` can name a deleted agent.
CREATE TABLE hosted_runtime (
    id UUID PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    size TEXT NOT NULL CHECK (size IN ('standard', 'large', 'xl')),
    vcpus INTEGER NOT NULL CHECK (vcpus > 0),
    memory_gib INTEGER NOT NULL CHECK (memory_gib > 0),
    disk_gib INTEGER NOT NULL CHECK (disk_gib > 0),
    catalog_entry TEXT NOT NULL,
    price_id TEXT,
    host_id UUID REFERENCES hosted_runtime_host (id) ON DELETE RESTRICT,
    awake BOOLEAN NOT NULL DEFAULT false,
    holds_units BOOLEAN NOT NULL DEFAULT true,
    state JSONB NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    enrollment_generation BIGINT NOT NULL DEFAULT 0
        CHECK (enrollment_generation BETWEEN 0 AND 4294967295),
    harness_id UUID REFERENCES harnesses (id) ON DELETE SET NULL,
    created_by TEXT NOT NULL REFERENCES "User" (id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    enrolled_at TIMESTAMPTZ,
    setup_completed_at TIMESTAMPTZ,
    default_agent_id UUID REFERENCES bots (id) ON DELETE SET NULL,
    image TEXT,
    previous_image TEXT,
    claude_notice_stage TEXT
        CHECK (claude_notice_stage IN ('expires_soon', 'expires_today', 'expired')),
    claude_notice_signed_in_at TIMESTAMPTZ,
    claude_notice_expires_at TIMESTAMPTZ,
    CONSTRAINT hosted_runtime_price_provenance_check
        CHECK ((price_id IS NULL) = (state->>'comp_reason' IS NOT NULL)),
    CONSTRAINT hosted_runtime_claude_notice_complete
        CHECK ((claude_notice_stage IS NULL) = (claude_notice_signed_in_at IS NULL))
);

CREATE INDEX hosted_runtime_team_idx ON hosted_runtime (team_id, created_at);
CREATE INDEX hosted_runtime_host_idx ON hosted_runtime (host_id) WHERE holds_units;
CREATE UNIQUE INDEX hosted_runtime_harness_idx ON hosted_runtime (harness_id)
    WHERE harness_id IS NOT NULL;
CREATE INDEX hosted_runtime_created_by_idx ON hosted_runtime (created_by);

-- The effect outbox. Workers lease rows by `worker` and key idempotency on `id`.
CREATE TABLE hosted_runtime_effect (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    computer_id UUID NOT NULL REFERENCES hosted_runtime (id) ON DELETE CASCADE,
    worker TEXT NOT NULL CHECK (worker IN ('fleet', 'billing')),
    effect JSONB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX hosted_runtime_effect_due_idx ON hosted_runtime_effect (worker, run_after);

-- At most one pending timer per kind per computer; scheduling replaces it.
CREATE TABLE hosted_runtime_timer (
    computer_id UUID NOT NULL REFERENCES hosted_runtime (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    fire_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (computer_id, kind)
);

CREATE INDEX hosted_runtime_timer_due_idx ON hosted_runtime_timer (fire_at);

-- "Notify me" requests for sold-out sizes.
CREATE TABLE hosted_runtime_waitlist (
    team_id UUID NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    size TEXT NOT NULL CHECK (size IN ('standard', 'large', 'xl')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id, size)
);

CREATE INDEX hosted_runtime_waitlist_user_idx ON hosted_runtime_waitlist (user_id);
