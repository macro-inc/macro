-- Macro computers: team-owned hosted VMs running macrod. Owned by crates/hosted_runtimes.

-- A fleet host, counted in units: max(ceil(memory_gib / 8), ceil(vcpus / 4)).
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
-- Deleting a team deletes its rows; the reconcile loop then destroys the
-- instances it no longer finds rows for.
CREATE TABLE hosted_runtime (
    id UUID PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- Display/pricing label; resources are independent purchase facts.
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
    harness_id UUID REFERENCES harnesses (id) ON DELETE SET NULL,
    persona JSONB,
    -- Preserve the purchaser needed for enrollment and billing attribution;
    -- delete the computer/team explicitly before deleting its purchaser.
    created_by TEXT NOT NULL REFERENCES "User" (id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    enrolled_at TIMESTAMPTZ,
    CHECK ((price_id IS NULL) = (state->>'comp_reason' IS NOT NULL))
);

CREATE INDEX hosted_runtime_created_by_idx ON hosted_runtime (created_by);
CREATE INDEX hosted_runtime_team_idx ON hosted_runtime (team_id, created_at);
CREATE INDEX hosted_runtime_host_idx ON hosted_runtime (host_id) WHERE holds_units;
CREATE UNIQUE INDEX hosted_runtime_harness_idx ON hosted_runtime (harness_id)
    WHERE harness_id IS NOT NULL;

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
