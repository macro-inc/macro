-- Rolling a new guest image onto existing Macro computers (owned by
-- crates/hosted_runtimes, domain::image_upgrade). An operator's upgrade names
-- an immutable image version, its files and the exact computers to move; the
-- control plane's upgrade pass stages the image on their hosts, then gives
-- each idle computer a fresh system disk of it, a few at a time, and rolls a
-- computer back when macrod does not come back. At most one unfinished
-- upgrade at a time.

SET LOCAL lock_timeout = '5s';

-- Where an upgrade stands: staging, rolling, paused (a computer was rolled
-- back; no further computer starts), done, failed (staging failed).
CREATE TYPE image_upgrade_state AS ENUM ('staging', 'rolling', 'paused', 'done', 'failed');

-- Where one computer of an upgrade stands. Under way (fleet effects wait,
-- reconcile skips it): replacing, verifying, rolling_back.
CREATE TYPE image_upgrade_computer_state AS ENUM (
    'waiting', 'replacing', 'verifying', 'rolling_back',
    'upgraded', 'skipped', 'rolled_back', 'rollback_failed', 'failed'
);

-- `files` holds each file's name, SHA-256 and size; `sources` the URLs hosts
-- fetch them from (presigned, short-lived), cleared once the image is
-- staged. `leased_until`/`leased_by`: the replica running the upgrade pass.
CREATE TABLE image_upgrade (
    id UUID PRIMARY KEY,
    image TEXT NOT NULL,
    files JSONB NOT NULL,
    sources JSONB,
    batch_size SMALLINT NOT NULL CHECK (batch_size BETWEEN 1 AND 5),
    idle_deadline_at TIMESTAMPTZ NOT NULL,
    reconnect_timeout_seconds INTEGER NOT NULL CHECK (reconnect_timeout_seconds > 0),
    state image_upgrade_state NOT NULL DEFAULT 'staging',
    error TEXT,
    created_by TEXT NOT NULL,
    leased_by UUID,
    leased_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX image_upgrade_unfinished_uq ON image_upgrade ((true))
    WHERE finished_at IS NULL;
CREATE INDEX image_upgrade_image_idx ON image_upgrade (image);

-- A computer's row records the image it left and the one it moved to.
-- `phase_started_at` is when its current state began; `reconnected_at` the
-- last macrod connection while it was under way. Rows go with their computer.
CREATE TABLE image_upgrade_computer (
    upgrade_id UUID NOT NULL REFERENCES image_upgrade (id) ON DELETE CASCADE,
    computer_id UUID NOT NULL REFERENCES hosted_runtime (id) ON DELETE CASCADE,
    position SMALLINT NOT NULL CHECK (position >= 0),
    state image_upgrade_computer_state NOT NULL DEFAULT 'waiting',
    old_image TEXT,
    new_image TEXT NOT NULL,
    phase_started_at TIMESTAMPTZ,
    reconnected_at TIMESTAMPTZ,
    error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (upgrade_id, computer_id)
);

-- Full, not partial: the computer delete's cascade finds rows by computer_id
-- alone, and the held checks filter the few rows of one computer by state.
CREATE INDEX image_upgrade_computer_computer_idx ON image_upgrade_computer (computer_id);
