-- Additive: old service versions omit this nullable field safely.
ALTER TABLE scheduling_booking ADD COLUMN recovery_at timestamptz;
CREATE INDEX scheduling_booking_recovery ON scheduling_booking(recovery_at)
    WHERE status IN ('processing', 'failed') AND recovery_at IS NOT NULL;
-- Bounded to two rows per profile. Deleting a profile also removes its budgets.
CREATE TABLE scheduling_public_budget (
    profile_id uuid NOT NULL REFERENCES scheduling_profile(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('availability', 'booking')),
    window_start timestamptz NOT NULL,
    used integer NOT NULL CHECK (used > 0),
    PRIMARY KEY (profile_id, kind)
);
