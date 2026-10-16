CREATE TABLE entity_access_request (
    id uuid PRIMARY KEY,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    requester_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    requested_level "AccessLevel" NOT NULL CHECK (requested_level IN ('comment', 'edit')),
    status text NOT NULL CHECK (status IN ('pending', 'granted', 'denied', 'cancelled')),
    revision integer NOT NULL CHECK (revision > 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    resolved_at timestamptz,
    granted_level "AccessLevel",
    retry_after timestamptz,
    UNIQUE (entity_type, entity_id, requester_id)
);

CREATE INDEX entity_access_request_pending ON entity_access_request
    (entity_type, entity_id, created_at, id) WHERE status = 'pending';

-- The notification ingress is idempotent on the event id. A committed request
-- survives a process crash or queue outage; workers retry delivery independently.
CREATE TABLE entity_access_request_event (
    id uuid PRIMARY KEY,
    request_id uuid REFERENCES entity_access_request(id) ON DELETE CASCADE,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz,
    available_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_access_request_event_pending ON entity_access_request_event
    (available_at, created_at) WHERE delivered_at IS NULL;
