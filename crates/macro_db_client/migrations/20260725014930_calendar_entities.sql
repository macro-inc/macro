-- CalendarEvent is a canonical Macro entity. Provider and email records are
-- sources of that entity; recurring instances are query projections.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE in_progress_user_link
    ADD COLUMN IF NOT EXISTS requested_google_scopes text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS granted_google_scopes text[] NOT NULL DEFAULT '{}';

ALTER TABLE email_links
    ADD COLUMN IF NOT EXISTS google_granted_scopes text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS google_grant_version bigint NOT NULL DEFAULT 0
        CHECK (google_grant_version >= 0);

CREATE TABLE IF NOT EXISTS calendar_accounts (
    id uuid PRIMARY KEY,
    owner_id text NOT NULL,
    email_link_id uuid NOT NULL UNIQUE
        REFERENCES email_links(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('google')),
    provider_account_id text NOT NULL,
    sync_status text NOT NULL DEFAULT 'pending'
        CHECK (sync_status IN (
            'pending', 'syncing', 'ready', 'error', 'reauth_required', 'disabled'
        )),
    last_synced_at timestamptz,
    last_sync_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_id, provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS calendar_accounts_owner_idx
    ON calendar_accounts (owner_id);

CREATE TABLE IF NOT EXISTS calendars (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL
        REFERENCES calendar_accounts(id) ON DELETE CASCADE,
    provider_calendar_id text NOT NULL,
    name text NOT NULL,
    description text,
    time_zone text,
    color text,
    access_role text,
    is_primary boolean NOT NULL DEFAULT false,
    is_selected boolean NOT NULL DEFAULT true,
    is_deleted boolean NOT NULL DEFAULT false,
    sync_token text,
    watch_channel_id text,
    watch_resource_id text,
    watch_expires_at timestamptz,
    materialized_starts_at timestamptz,
    materialized_ends_at timestamptz,
    materialized_start_date date,
    materialized_end_date date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, provider_calendar_id),
    CONSTRAINT calendars_materialized_range CHECK (
        (
            materialized_starts_at IS NULL
            AND materialized_ends_at IS NULL
            AND materialized_start_date IS NULL
            AND materialized_end_date IS NULL
        )
        OR
        (
            materialized_starts_at IS NOT NULL
            AND materialized_ends_at IS NOT NULL
            AND materialized_start_date IS NOT NULL
            AND materialized_end_date IS NOT NULL
            AND materialized_ends_at > materialized_starts_at
            AND materialized_end_date > materialized_start_date
        )
    )
);

CREATE INDEX IF NOT EXISTS calendars_account_selected_idx
    ON calendars (account_id, is_selected)
    WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS calendars_watch_expiring_idx
    ON calendars (watch_expires_at)
    WHERE watch_channel_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS calendar_events (
    id uuid PRIMARY KEY,
    owner_id text NOT NULL,
    source_link_id uuid NOT NULL
        REFERENCES email_links(id) ON DELETE CASCADE,
    ical_uid text NOT NULL,
    title text NOT NULL DEFAULT '',
    description text,
    location text,
    status text NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
    visibility text NOT NULL DEFAULT 'default'
        CHECK (visibility IN ('default', 'public', 'private', 'confidential')),
    transparency text NOT NULL DEFAULT 'opaque'
        CHECK (transparency IN ('opaque', 'transparent')),
    starts_at timestamptz,
    ends_at timestamptz,
    start_date date,
    end_date date,
    time_zone text,
    recurrence_lines text[] NOT NULL DEFAULT '{}',
    organizer_email text,
    organizer_name text,
    conference_url text,
    sequence integer NOT NULL DEFAULT 0 CHECK (sequence >= 0),
    is_read_only boolean NOT NULL DEFAULT false,
    canonical_source_kind text NOT NULL
        CHECK (canonical_source_kind IN ('google', 'email_ics')),
    canonical_source_updated_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_id, source_link_id, ical_uid),
    UNIQUE (id, owner_id),
    UNIQUE (id, source_link_id),
    CONSTRAINT calendar_events_time_shape CHECK (
        (
            starts_at IS NOT NULL
            AND ends_at IS NOT NULL
            AND start_date IS NULL
            AND end_date IS NULL
            AND ends_at > starts_at
        )
        OR
        (
            starts_at IS NULL
            AND ends_at IS NULL
            AND start_date IS NOT NULL
            AND end_date IS NOT NULL
            AND end_date > start_date
        )
    )
);

CREATE INDEX IF NOT EXISTS calendar_events_owner_updated_idx
    ON calendar_events (owner_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS calendar_events_owner_created_idx
    ON calendar_events (owner_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS calendar_events_source_link_idx
    ON calendar_events (source_link_id);

CREATE TABLE IF NOT EXISTS calendar_event_sources (
    id uuid PRIMARY KEY,
    event_id uuid NOT NULL,
    source_link_id uuid NOT NULL
        REFERENCES email_links(id) ON DELETE CASCADE,
    source_kind text NOT NULL
        CHECK (source_kind IN ('google', 'email_ics')),
    account_id uuid
        REFERENCES calendar_accounts(id) ON DELETE CASCADE,
    calendar_id uuid
        REFERENCES calendars(id) ON DELETE CASCADE,
    provider_event_id text,
    provider_recurring_event_id text,
    provider_etag text,
    email_link_id uuid
        REFERENCES email_links(id) ON DELETE CASCADE,
    email_thread_id uuid,
    email_message_id uuid,
    email_attachment_id text,
    content_hash text,
    parser_version integer NOT NULL DEFAULT 1 CHECK (parser_version > 0),
    raw_payload jsonb NOT NULL DEFAULT '{}',
    source_sequence integer NOT NULL CHECK (source_sequence >= 0),
    source_updated_at timestamptz NOT NULL,
    normalized_payload jsonb NOT NULL,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT calendar_event_sources_event_link_fkey
        FOREIGN KEY (event_id, source_link_id)
        REFERENCES calendar_events(id, source_link_id) ON DELETE CASCADE,
    CONSTRAINT calendar_event_sources_shape CHECK (
        (
            source_kind = 'google'
            AND account_id IS NOT NULL
            AND calendar_id IS NOT NULL
            AND provider_event_id IS NOT NULL
            AND email_link_id IS NULL
        )
        OR
        (
            source_kind = 'email_ics'
            AND email_link_id IS NOT NULL
            AND email_message_id IS NOT NULL
            AND content_hash IS NOT NULL
            AND account_id IS NULL
            AND calendar_id IS NULL
            AND provider_event_id IS NULL
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_sources_google_idx
    ON calendar_event_sources (account_id, calendar_id, provider_event_id)
    WHERE source_kind = 'google';

CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_sources_email_idx
    ON calendar_event_sources (
        email_link_id,
        email_message_id,
        COALESCE(email_attachment_id, ''),
        content_hash,
        event_id
    )
    WHERE source_kind = 'email_ics';

CREATE INDEX IF NOT EXISTS calendar_event_sources_event_idx
    ON calendar_event_sources (event_id);

CREATE INDEX IF NOT EXISTS calendar_event_sources_source_link_idx
    ON calendar_event_sources (source_link_id);

CREATE INDEX IF NOT EXISTS calendar_event_sources_email_link_idx
    ON calendar_event_sources (email_link_id)
    WHERE email_link_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS calendar_event_sources_account_idx
    ON calendar_event_sources (account_id)
    WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS calendar_event_sources_calendar_idx
    ON calendar_event_sources (calendar_id)
    WHERE calendar_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS calendar_event_attendees (
    event_id uuid NOT NULL
        REFERENCES calendar_events(id) ON DELETE CASCADE,
    email text NOT NULL,
    display_name text,
    response_status text NOT NULL DEFAULT 'needs_action'
        CHECK (response_status IN ('needs_action', 'accepted', 'declined', 'tentative')),
    is_organizer boolean NOT NULL DEFAULT false,
    is_optional boolean NOT NULL DEFAULT false,
    is_self boolean NOT NULL DEFAULT false,
    comment text,
    PRIMARY KEY (event_id, email)
);

CREATE INDEX IF NOT EXISTS calendar_event_attendees_email_idx
    ON calendar_event_attendees (lower(email));

CREATE TABLE IF NOT EXISTS calendar_event_overrides (
    event_id uuid NOT NULL
        REFERENCES calendar_events(id) ON DELETE CASCADE,
    recurrence_id text NOT NULL,
    original_starts_at timestamptz,
    original_start_date date,
    starts_at timestamptz,
    ends_at timestamptz,
    start_date date,
    end_date date,
    title text,
    description text,
    location text,
    status text
        CHECK (status IS NULL OR status IN ('confirmed', 'tentative', 'cancelled')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, recurrence_id),
    CONSTRAINT calendar_event_overrides_original_shape CHECK (
        (original_starts_at IS NOT NULL) <> (original_start_date IS NOT NULL)
    ),
    CONSTRAINT calendar_event_overrides_time_shape CHECK (
        (
            starts_at IS NOT NULL
            AND ends_at IS NOT NULL
            AND start_date IS NULL
            AND end_date IS NULL
            AND ends_at > starts_at
        )
        OR
        (
            starts_at IS NULL
            AND ends_at IS NULL
            AND start_date IS NOT NULL
            AND end_date IS NOT NULL
            AND end_date > start_date
        )
    )
);

CREATE TABLE IF NOT EXISTS calendar_event_occurrences (
    event_id uuid NOT NULL,
    owner_id text NOT NULL,
    occurrence_key text NOT NULL,
    recurrence_id text,
    starts_at timestamptz,
    ends_at timestamptz,
    start_date date,
    end_date date,
    is_cancelled boolean NOT NULL DEFAULT false,
    timed_span tstzrange GENERATED ALWAYS AS (
        CASE
            WHEN starts_at IS NOT NULL
                THEN tstzrange(starts_at, ends_at, '[)')
        END
    ) STORED,
    day_span daterange GENERATED ALWAYS AS (
        CASE
            WHEN start_date IS NOT NULL
                THEN daterange(start_date, end_date, '[)')
        END
    ) STORED,
    generated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, occurrence_key),
    CONSTRAINT calendar_event_occurrences_event_owner_fkey
        FOREIGN KEY (event_id, owner_id)
        REFERENCES calendar_events(id, owner_id) ON DELETE CASCADE,
    CONSTRAINT calendar_event_occurrences_time_shape CHECK (
        (
            starts_at IS NOT NULL
            AND ends_at IS NOT NULL
            AND start_date IS NULL
            AND end_date IS NULL
            AND ends_at > starts_at
        )
        OR
        (
            starts_at IS NULL
            AND ends_at IS NULL
            AND start_date IS NOT NULL
            AND end_date IS NOT NULL
            AND end_date > start_date
        )
    )
);

CREATE INDEX IF NOT EXISTS calendar_event_occurrences_timed_span_idx
    ON calendar_event_occurrences USING gist (owner_id, timed_span)
    WHERE NOT is_cancelled AND timed_span IS NOT NULL;

CREATE INDEX IF NOT EXISTS calendar_event_occurrences_day_span_idx
    ON calendar_event_occurrences USING gist (owner_id, day_span)
    WHERE NOT is_cancelled AND day_span IS NOT NULL;

CREATE INDEX IF NOT EXISTS calendar_event_occurrences_event_start_idx
    ON calendar_event_occurrences (owner_id, event_id, starts_at, start_date)
    WHERE NOT is_cancelled;

ALTER TABLE email_backfill_jobs
    ADD COLUMN IF NOT EXISTS init_lease_token uuid,
    ADD COLUMN IF NOT EXISTS init_lease_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS initialized_at timestamptz;

CREATE TABLE IF NOT EXISTS email_backfill_init_outbox (
    id uuid PRIMARY KEY,
    backfill_job_id uuid NOT NULL UNIQUE
        REFERENCES email_backfill_jobs(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);

CREATE INDEX IF NOT EXISTS email_backfill_init_outbox_unpublished_idx
    ON email_backfill_init_outbox (created_at, id)
    WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS email_backfill_completion_outbox (
    id uuid PRIMARY KEY,
    backfill_job_id uuid NOT NULL UNIQUE
        REFERENCES email_backfill_jobs(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    completed_at timestamptz,
    effects_lease_token uuid,
    effects_lease_expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS email_backfill_completion_outbox_unpublished_idx
    ON email_backfill_completion_outbox (created_at, id)
    WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS calendar_backfill_jobs (
    id uuid PRIMARY KEY,
    email_link_id uuid NOT NULL
        REFERENCES email_links(id) ON DELETE CASCADE,
    account_id uuid
        REFERENCES calendar_accounts(id) ON DELETE CASCADE,
    kind text NOT NULL
        CHECK (kind IN ('google_calendar', 'email_ics')),
    grant_version bigint NOT NULL CHECK (grant_version > 0),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'complete', 'failed')),
    cursor jsonb NOT NULL DEFAULT '{}',
    scanned_count bigint NOT NULL DEFAULT 0 CHECK (scanned_count >= 0),
    extracted_count bigint NOT NULL DEFAULT 0 CHECK (extracted_count >= 0),
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    lease_token uuid,
    lease_expires_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (email_link_id, kind, grant_version)
);

CREATE INDEX IF NOT EXISTS calendar_backfill_jobs_pending_idx
    ON calendar_backfill_jobs (created_at, id)
    WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS calendar_backfill_jobs_account_idx
    ON calendar_backfill_jobs (account_id)
    WHERE account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS calendar_sync_outbox (
    id uuid PRIMARY KEY,
    backfill_job_id uuid NOT NULL UNIQUE
        REFERENCES calendar_backfill_jobs(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);

CREATE INDEX IF NOT EXISTS calendar_sync_outbox_unpublished_idx
    ON calendar_sync_outbox (created_at, id)
    WHERE published_at IS NULL;
