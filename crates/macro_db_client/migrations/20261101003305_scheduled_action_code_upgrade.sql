-- Each time a routine's code steps were brought to a new SDK: checked as they
-- were, rewritten by a model, or left for their owner to review. One row per
-- routine and SDK makes an upgrade happen once, however many runs see the new
-- SDK at the same time. Rows go with their routine.
SET LOCAL lock_timeout = '5s';

CREATE TABLE scheduled_action_code_upgrade (
    id uuid PRIMARY KEY,
    action_id uuid NOT NULL REFERENCES scheduled_action(id) ON DELETE CASCADE,
    -- The SDK the code was checked against before; null when it never was.
    from_sdk text,
    to_sdk text NOT NULL CHECK (to_sdk <> ''),
    -- running: claimed by a run; checked: the code checked as it was;
    -- rewritten: a model's rewrite checked and was saved; needs_update: the
    -- routine was paused for its owner.
    outcome text NOT NULL CHECK (outcome IN ('running', 'checked', 'rewritten', 'needs_update')),
    -- The task before the upgrade.
    previous_task jsonb NOT NULL,
    -- The saved rewrite, or the rewrite that failed its checks.
    task jsonb,
    -- Why the routine needs its owner, written for them.
    reason text CHECK (char_length(reason) <= 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (action_id, to_sdk),
    CHECK ((outcome = 'needs_update') = (reason IS NOT NULL)),
    CHECK (outcome <> 'rewritten' OR task IS NOT NULL)
);
