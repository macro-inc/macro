-- The code Macro wrote in upgrades of the routine a sub-routine's copy ran,
-- kept when the copy is made standalone: its owner's identity stays off that
-- code until they change it. Apart from scheduled_action_code_upgrade, whose
-- (action_id, to_sdk) rows are the routine's own upgrade claims. One row per
-- such routine, written once; most routines have none.
CREATE TABLE scheduled_action_inherited_rewrite (
    action_id uuid PRIMARY KEY REFERENCES scheduled_action (id) ON DELETE CASCADE,
    sources text[] NOT NULL CHECK (cardinality(sources) > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
