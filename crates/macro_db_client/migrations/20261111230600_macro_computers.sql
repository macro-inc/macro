-- Macro computers: team-owned hosted VMs running macrod, owned by
-- crates/hosted_runtimes, plus what they need from existing tables.

SET LOCAL lock_timeout = '5s';

-- Existing tables: additive, metadata-only changes (nullable columns or
-- constant defaults; no rewrite).

-- `computer_id` is the Macro computer a harness runs on; null for a machine
-- the user paired. No foreign key: computers outlive soft-deleted harness
-- rows.
ALTER TABLE public.harnesses
    ADD COLUMN computer_id uuid;

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

-- New types.

-- An agent's account provider. New providers add a value.
CREATE TYPE agent_provider AS ENUM ('claude');
-- The last sign-in expiry notice sent for a login.
CREATE TYPE account_notice_stage AS ENUM ('expires_soon', 'expires_today', 'expired');
-- How a subscription item change ended. `abandoned` is a change whose
-- outcome was never learned and that may no longer be sent.
CREATE TYPE subscription_item_change_outcome AS ENUM
    ('pending', 'succeeded', 'payment_failed', 'abandoned');
-- A Macro computer's catalog size.
CREATE TYPE computer_size AS ENUM ('standard', 'large', 'xl');
-- Which worker carries out a computer's outbox effect.
CREATE TYPE computer_effect_worker AS ENUM ('fleet', 'billing');
-- A computer's pending lifecycle timer.
CREATE TYPE computer_timer_kind AS ENUM (
    'macrod_missing', 'restart_due', 'power_on_retry', 'capacity_changed',
    'billing_ends', 'past_due_grace', 'retention_expired'
);

-- New tables.

-- An account at an agent's provider (e.g. a Claude account), shared by every
-- machine it is signed in on. `external_account_id` identifies it at the
-- provider (Claude: harnessd's fingerprint of its setup-token credential,
-- which names no account).
CREATE TABLE provider_accounts (
    id UUID PRIMARY KEY,
    provider agent_provider NOT NULL,
    external_account_id TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, external_account_id),
    -- The target of harness_account_logins' provider-matching foreign key.
    UNIQUE (id, provider)
);

-- One sign-in of a provider account on a machine. A new sign-in inserts a row
-- and signs the previous one out, so history stays as signed-out rows. A
-- machine uses its own account at a provider while it has an active row
-- (otherwise Macro credits). The control plane writes these from harnessd's
-- status on the machine, after each sign-in command and on a timer, holding
-- a per-computer lock from the command to the write so an older status
-- never overwrites a newer outcome. `expires_at` is the credential's expiry
-- as harnessd last reported it; the notice columns are the last expiry
-- notice sent for this sign-in and the expiry it warned about.
CREATE TABLE harness_account_logins (
    id UUID PRIMARY KEY,
    harness_id UUID NOT NULL REFERENCES harnesses (id) ON DELETE CASCADE,
    provider_account_id UUID NOT NULL,
    provider agent_provider NOT NULL,
    signed_in_by TEXT REFERENCES "User" (id) ON DELETE SET NULL,
    signed_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    signed_out_at TIMESTAMPTZ,
    notice_stage account_notice_stage,
    notice_expires_at TIMESTAMPTZ,
    FOREIGN KEY (provider_account_id, provider) REFERENCES provider_accounts (id, provider)
);

-- One active login per provider per machine.
CREATE UNIQUE INDEX harness_account_logins_active_uq
    ON harness_account_logins (harness_id, provider) WHERE signed_out_at IS NULL;
CREATE INDEX harness_account_logins_account_idx ON harness_account_logins (provider_account_id);
CREATE INDEX harness_account_logins_signed_in_by_idx ON harness_account_logins (signed_in_by);

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
    outcome subscription_item_change_outcome NOT NULL DEFAULT 'pending',
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

-- A purchase holding host capacity while its charge is confirmed. `id` is
-- the future computer's id. Created under the host lock; the purchase
-- request (or the confirm worker, until `expires_at`) deletes it, inserting
-- the computer in the same transaction when the charge succeeded.
-- `purchase_key` is the buyer's client key, reused when a purchase is
-- retried, so a retry finds this reservation or the computer it became.
-- `price_id` is null for a comped purchase, which has a `comp_reason`.
-- `team_id` has no foreign key: deleting a team first releases its computers
-- and reservations through hosted_runtimes.
CREATE TABLE computer_reservation (
    id UUID PRIMARY KEY,
    team_id UUID NOT NULL,
    host_id UUID NOT NULL REFERENCES hosted_runtime_host (id) ON DELETE RESTRICT,
    size computer_size NOT NULL,
    vcpus INTEGER NOT NULL CHECK (vcpus > 0),
    memory_gib INTEGER NOT NULL CHECK (memory_gib > 0),
    disk_gib INTEGER NOT NULL CHECK (disk_gib > 0),
    catalog_entry TEXT NOT NULL,
    price_id TEXT,
    comp_reason TEXT,
    name TEXT NOT NULL,
    purchase_key TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL,
    extra_items JSONB NOT NULL,
    provision_traceparent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX computer_reservation_team_idx ON computer_reservation (team_id, created_at);
CREATE INDEX computer_reservation_host_idx ON computer_reservation (host_id);

-- One computer. `state` is the lifecycle's ComputerState: the machine's
-- phase (`state.phase.phase`) and, beside it, its billing
-- (`state.billing.billing`). `awake` mirrors it for capacity queries and is
-- written with it. A computer holds sold capacity on `host_id` until its
-- phase is `destroying`. The resources, catalog entry, price and comp reason
-- are snapshotted at purchase; comped computers have no price.
-- `purchase_key` is the key of the purchase that bought it. `created_by`
-- keeps the buyer's id without a foreign key, so attribution survives the
-- buyer's account deletion without ever blocking it.
-- `team_id` has no foreign key: rows outlive a deleted team until their
-- release effects (billing removal, destroy, harness revocation) have run.
-- `image` is the image the computer was created from, null until the first
-- creation finishes.
-- Bots are soft-deleted, so `default_agent_id` can name a deleted agent.
CREATE TABLE hosted_runtime (
    id UUID PRIMARY KEY,
    team_id UUID NOT NULL,
    name TEXT NOT NULL,
    size computer_size NOT NULL,
    vcpus INTEGER NOT NULL CHECK (vcpus > 0),
    memory_gib INTEGER NOT NULL CHECK (memory_gib > 0),
    disk_gib INTEGER NOT NULL CHECK (disk_gib > 0),
    catalog_entry TEXT NOT NULL,
    price_id TEXT,
    comp_reason TEXT,
    purchase_key TEXT NOT NULL UNIQUE,
    host_id UUID NOT NULL REFERENCES hosted_runtime_host (id) ON DELETE RESTRICT,
    awake BOOLEAN NOT NULL DEFAULT false,
    state JSONB NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    enrollment_generation BIGINT NOT NULL DEFAULT 0
        CHECK (enrollment_generation BETWEEN 0 AND 4294967295),
    harness_id UUID REFERENCES harnesses (id) ON DELETE SET NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    enrolled_at TIMESTAMPTZ,
    setup_completed_at TIMESTAMPTZ,
    default_agent_id UUID REFERENCES bots (id) ON DELETE SET NULL,
    image TEXT
);

CREATE INDEX hosted_runtime_team_idx ON hosted_runtime (team_id, created_at);
CREATE INDEX hosted_runtime_host_idx ON hosted_runtime (host_id)
    WHERE (state->'phase'->>'phase') <> 'destroying';
CREATE UNIQUE INDEX hosted_runtime_harness_idx ON hosted_runtime (harness_id)
    WHERE harness_id IS NOT NULL;

-- A computer's harness belongs to the computer's team, not to whoever bought
-- it: the team's owner and admins own it, its other members use it, and
-- leaving the team ends both. Paired machines keep the rule from
-- 20261104182740_harness_sharing unchanged.
CREATE OR REPLACE FUNCTION harness_access_level(p_harness uuid, p_user text)
RETURNS "AccessLevel"
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN h.computer_id IS NOT NULL THEN (
            SELECT CASE
                WHEN t.owner_id = p_user OR tu.team_role IN ('owner', 'admin')
                    THEN 'owner'::"AccessLevel"
                WHEN tu.user_id IS NOT NULL THEN 'edit'::"AccessLevel"
            END
            FROM hosted_runtime c
            JOIN team t ON t.id = c.team_id
            LEFT JOIN team_user tu ON tu.team_id = c.team_id AND tu.user_id = p_user
            WHERE c.id = h.computer_id
        )
        WHEN COALESCE(h.owner_user_id, h.created_by) = p_user THEN 'owner'::"AccessLevel"
        ELSE (
            SELECT max(ea.access_level)
            FROM entity_access ea
            WHERE ea.entity_id = h.id
              AND ea.entity_type = 'harness'
              AND (
                (
                    ea.source_type = 'team'
                    AND ea.source_id IN (
                        SELECT tu.team_id::text FROM team_user tu WHERE tu.user_id = p_user
                    )
                )
                OR (
                    ea.source_type = 'user'
                    AND ea.source_id = p_user
                    AND EXISTS (
                        SELECT 1
                        FROM team_user mine
                        JOIN team_user theirs ON theirs.team_id = mine.team_id
                        WHERE mine.user_id = p_user
                          AND theirs.user_id = COALESCE(h.owner_user_id, h.created_by)
                    )
                )
              )
        )
    END
    FROM harnesses h
    WHERE h.id = p_harness AND h.deleted_at IS NULL
$$;

-- The effect outbox. Workers lease rows by `worker` and key idempotency on `id`.
CREATE TABLE hosted_runtime_effect (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    computer_id UUID NOT NULL REFERENCES hosted_runtime (id) ON DELETE CASCADE,
    worker computer_effect_worker NOT NULL,
    effect JSONB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX hosted_runtime_effect_due_idx ON hosted_runtime_effect (worker, run_after);

-- At most one pending timer per kind per computer; scheduling replaces it.
-- `fire_at` is when the timer's lifecycle event is due: the operator's
-- timer pass delivers every row with fire_at <= now and deletes it in the
-- same transaction, only if fire_at is still the one it read (a rescheduled
-- timer survives). Timers are never cancelled; an event that no longer
-- applies is ignored by the lifecycle.
CREATE TABLE hosted_runtime_timer (
    computer_id UUID NOT NULL REFERENCES hosted_runtime (id) ON DELETE CASCADE,
    kind computer_timer_kind NOT NULL,
    fire_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (computer_id, kind)
);

CREATE INDEX hosted_runtime_timer_due_idx ON hosted_runtime_timer (fire_at);
