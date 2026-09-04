-- One globally exclusive socket owner for each externally hosted harness.
-- A pending owner is immediately routable but expires quickly unless the
-- gateway promotes its exact token after attaching the socket locally.
CREATE TABLE harness_runtime_lease (
    harness_id UUID PRIMARY KEY REFERENCES harnesses(id) ON DELETE CASCADE,
    replica_id UUID NOT NULL REFERENCES harness_replica(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL,
    pending_until TIMESTAMPTZ NOT NULL DEFAULT now() + interval '5 seconds'
);

CREATE INDEX harness_runtime_lease_replica_id_idx
    ON harness_runtime_lease (replica_id);
