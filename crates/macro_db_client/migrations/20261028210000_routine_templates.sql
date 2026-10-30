-- A routine shared as a template: a snapshot of the source routine that other
-- people activate as their own routine. Keyed by the source routine, so a link
-- to a shared routine is a link to its template.
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS scheduled_action_template (
    action_id UUID PRIMARY KEY REFERENCES scheduled_action (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    trigger_config JSONB NOT NULL,
    task JSONB NOT NULL,
    variables JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The template a routine was activated from. A plain pointer, not a foreign
-- key: activated routines keep running after their template stops being shared.
ALTER TABLE scheduled_action
    ADD COLUMN IF NOT EXISTS template_id UUID;
