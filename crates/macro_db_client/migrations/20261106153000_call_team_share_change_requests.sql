-- A team-sharing change a call participant proposed, awaiting the others.
-- Keyed by the call entity, so a request survives the call being archived.
CREATE TABLE call_team_share_change_requests (
    call_id UUID PRIMARY KEY REFERENCES call_entities(id) ON DELETE CASCADE,
    shared BOOLEAN NOT NULL,
    requested_by TEXT NOT NULL,
    approved_by TEXT[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
