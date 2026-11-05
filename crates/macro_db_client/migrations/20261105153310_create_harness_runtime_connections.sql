-- One row per live harness runtime connection, written by the replica holding
-- its socket. A harness is connected while a row with an unexpired lease exists,
-- so one connection's close cannot affect another's, whatever order replicas
-- notice them in, and a replica that crashes takes its connections offline when
-- its leases lapse.
CREATE TABLE public.harness_runtime_connection (
    harness_id uuid NOT NULL REFERENCES public.harnesses(id) ON DELETE CASCADE,
    id uuid NOT NULL,
    replica_id uuid NOT NULL,
    connected_at timestamptz NOT NULL DEFAULT now(),
    lease_expires_at timestamptz NOT NULL,
    PRIMARY KEY (harness_id, id)
);
