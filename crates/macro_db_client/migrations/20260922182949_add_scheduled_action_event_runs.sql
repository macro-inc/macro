-- Nullable for deployed cron/manual writers. New writers fence every claim.
ALTER TABLE scheduled_action ADD COLUMN claim_token UUID;

CREATE TABLE scheduled_action_event_run (
    action_id UUID NOT NULL REFERENCES scheduled_action (id) ON DELETE CASCADE,
    event_id UUID NOT NULL,
    configuration_revision BIGINT NOT NULL CHECK (configuration_revision > 0),
    -- Only event name, entity ID and optional message ID; never broker content.
    event_context JSONB NOT NULL CHECK (jsonb_typeof(event_context) = 'object'),
    admission_order BIGINT GENERATED ALWAYS AS IDENTITY,
    admitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'started', 'finished')),
    claim_token UUID,
    started_at TIMESTAMPTZ,
    deadline TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    outcome JSONB,
    execution_record_id UUID REFERENCES action_execution_record (id) ON DELETE SET NULL,
    PRIMARY KEY (action_id, event_id),
    CONSTRAINT scheduled_action_event_run_lifecycle CHECK (
        (state = 'pending' AND claim_token IS NULL AND started_at IS NULL
            AND deadline IS NULL AND finished_at IS NULL AND outcome IS NULL
            AND execution_record_id IS NULL)
        OR (state = 'started' AND claim_token IS NOT NULL AND started_at IS NOT NULL
            AND deadline IS NOT NULL AND deadline > started_at AND finished_at IS NULL AND outcome IS NULL
            AND execution_record_id IS NULL)
        OR (state = 'finished' AND finished_at IS NOT NULL AND outcome IS NOT NULL
            AND ((claim_token IS NULL AND started_at IS NULL AND deadline IS NULL)
                OR (claim_token IS NOT NULL AND started_at IS NOT NULL
                    AND deadline IS NOT NULL AND deadline > started_at)))
    ),
    CONSTRAINT scheduled_action_event_run_outcome CHECK (
        outcome IS NULL OR (outcome ->> 'type' IN ('succeeded', 'failed', 'cancelled', 'interrupted')) IS TRUE
    )
);

-- Serialize one action's queue; admission takes the action lock before allocating
-- its sequence number, so sequence order is also committed admission order.
CREATE INDEX scheduled_action_event_run_pending_idx
    ON scheduled_action_event_run (action_id, admission_order) WHERE state = 'pending';
CREATE UNIQUE INDEX scheduled_action_event_run_started_idx
    ON scheduled_action_event_run (action_id) WHERE state = 'started';
CREATE INDEX scheduled_action_event_run_deadline_idx
    ON scheduled_action_event_run (deadline, action_id) WHERE state = 'started';
CREATE INDEX scheduled_action_event_filters_idx
    ON scheduled_action USING GIN (event_filters jsonb_path_ops)
    WHERE trigger_type = 'events' AND enabled;

-- Finished rows are deduplication tombstones, retained until action deletion.
