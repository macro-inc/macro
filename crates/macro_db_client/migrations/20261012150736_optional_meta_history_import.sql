-- Explicit history consent and resumable work, separate from legacy automatic-sync flags.
CREATE TABLE meta_messaging_history_import (
    connection_id uuid PRIMARY KEY REFERENCES meta_messaging_connection(id) ON DELETE CASCADE,
    connected_at timestamptz NOT NULL,
    user_id text NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL CHECK (status IN ('pending','syncing','complete','declined','failed')),
    step text NOT NULL CHECK (step IN ('contacts','contacts_requested','messages','waiting','instagram')),
    cursor text,
    contacts_request_id text,
    history_request_id text,
    progress smallint CHECK (progress BETWEEN 0 AND 100),
    error_code text,
    unavailable_media boolean NOT NULL DEFAULT false,
    attempts smallint NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_id uuid,
    lease_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meta_messaging_history_import_work ON meta_messaging_history_import(available_at)
    WHERE status IN ('pending','syncing') AND step <> 'waiting';
