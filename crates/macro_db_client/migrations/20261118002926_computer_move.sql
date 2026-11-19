-- Moving a Macro computer to another host (owned by crates/hosted_runtimes,
-- domain::moves). A move copies the computer's dataset host to host while it
-- runs, then stops it, copies the rest, starts it on the new host and flips
-- hosted_runtime.host_id. At most one open move per computer.

SET LOCAL lock_timeout = '5s';

-- Where a move stands. Open: seeding, cutting_over, verifying, rolling_back.
-- Finished: committed, rolled_back, failed.
CREATE TYPE computer_move_stage AS ENUM (
    'seeding', 'cutting_over', 'verifying', 'rolling_back',
    'committed', 'rolled_back', 'failed'
);

-- `ticket` authorizes the source host's agent to push this computer to the
-- target's migration listener (on the private host mesh); it is random,
-- sent to both agents by the control plane, and cleared when the move
-- finishes. `was_running` is whether the computer ran when the cutover
-- began, so the new host starts it. `flipped_at` is when host_id moved to
-- `to_host`; verification waits for macrod to connect after it. Moves are
-- deleted with their computer: a released computer's move has nothing left
-- to do.
CREATE TABLE computer_move (
    id UUID PRIMARY KEY,
    computer_id UUID NOT NULL REFERENCES hosted_runtime (id) ON DELETE CASCADE,
    from_host UUID NOT NULL REFERENCES hosted_runtime_host (id) ON DELETE RESTRICT,
    to_host UUID NOT NULL REFERENCES hosted_runtime_host (id) ON DELETE RESTRICT,
    stage computer_move_stage NOT NULL,
    ticket TEXT,
    rounds INTEGER NOT NULL DEFAULT 0 CHECK (rounds >= 0),
    last_round_bytes BIGINT CHECK (last_round_bytes >= 0),
    was_running BOOLEAN,
    flipped_at TIMESTAMPTZ,
    error TEXT,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    CHECK (from_host <> to_host)
);

CREATE UNIQUE INDEX computer_move_open_uq ON computer_move (computer_id)
    WHERE stage IN ('seeding', 'cutting_over', 'verifying', 'rolling_back');
CREATE INDEX computer_move_computer_idx ON computer_move (computer_id, created_at);
-- Host rows are RESTRICT-referenced: deleting a host checks its moves.
CREATE INDEX computer_move_from_host_idx ON computer_move (from_host);
CREATE INDEX computer_move_to_host_idx ON computer_move (to_host);
