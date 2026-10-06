-- Scheduling owns its configuration, booking snapshots, and host reservations.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE scheduling_profile (
    id uuid PRIMARY KEY,
    user_id text REFERENCES "User"(id) ON DELETE CASCADE,
    team_id uuid REFERENCES team(id) ON DELETE CASCADE,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    configuration jsonb NOT NULL,
    CHECK (num_nonnulls(user_id, team_id) = 1)
);
CREATE UNIQUE INDEX scheduling_profile_user ON scheduling_profile(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX scheduling_profile_team ON scheduling_profile(team_id) WHERE team_id IS NOT NULL;
CREATE TABLE scheduling_booking (
    id uuid PRIMARY KEY,
    profile_id uuid NOT NULL REFERENCES scheduling_profile(id) ON DELETE CASCADE,
    request_id uuid NOT NULL UNIQUE,
    event_type_id uuid NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    status text NOT NULL CHECK (status IN ('pending','processing','confirmed','cancelled','failed')),
    record jsonb NOT NULL,
    CHECK (ends_at > starts_at)
);
CREATE INDEX scheduling_booking_profile_time ON scheduling_booking(profile_id, starts_at);
CREATE TABLE scheduling_host_claim (
    booking_id uuid NOT NULL REFERENCES scheduling_booking(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    occupied tstzmultirange NOT NULL,
    PRIMARY KEY (booking_id, user_id),
    EXCLUDE USING gist (user_id WITH =, occupied WITH &&)
);
