-- Import-owned provenance outlives job receipts and staging objects. Team deletion
-- removes provenance; channel/message deletion removes only its own mappings.
-- No FK in this migration can delete a user-visible channel or message.
CREATE TABLE import_source_binding (
    team_id uuid PRIMARY KEY REFERENCES team (id) ON DELETE CASCADE,
    slack_workspace_id text CHECK (slack_workspace_id ~ '^T[A-Z0-9]{1,63}$'),
    confirmed_unknown_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (slack_workspace_id IS NOT NULL OR confirmed_unknown_at IS NOT NULL)
);

CREATE FUNCTION preserve_import_source_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.team_id <> OLD.team_id OR
       (OLD.slack_workspace_id IS NOT NULL AND
        NEW.slack_workspace_id IS DISTINCT FROM OLD.slack_workspace_id) THEN
        RAISE EXCEPTION 'import source binding is immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_import_source_binding
BEFORE UPDATE ON import_source_binding
FOR EACH ROW EXECUTE FUNCTION preserve_import_source_binding();

-- Shared by onboarding and archive, not attached to an archive job. The candidate
-- deliberately has no channel FK: allocation must commit BEFORE channel creation.
-- Deleting a ready target releases its reservation; deleting a job never does.
CREATE TABLE import_target_reservation (
    team_id uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    source text NOT NULL CHECK (source = 'slack'),
    foreign_id text NOT NULL CHECK (foreign_id ~ '^[CGD][A-Z0-9]{1,63}$'),
    candidate_channel_id uuid NOT NULL,
    channel_id uuid REFERENCES comms_channels (id) ON DELETE CASCADE,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'conflict')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, source, foreign_id),
    CHECK ((state = 'ready') = (channel_id IS NOT NULL))
);
CREATE INDEX import_target_reservation_channel_idx ON import_target_reservation (channel_id)
    WHERE channel_id IS NOT NULL;

CREATE FUNCTION preserve_import_target_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.team_id, NEW.source, NEW.foreign_id, NEW.candidate_channel_id)
       IS DISTINCT FROM (OLD.team_id, OLD.source, OLD.foreign_id, OLD.candidate_channel_id)
       OR (OLD.state = 'ready' AND
           (NEW.state, NEW.channel_id) IS DISTINCT FROM (OLD.state, OLD.channel_id)) THEN
        RAISE EXCEPTION 'import target reservation is immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_import_target_reservation
BEFORE UPDATE ON import_target_reservation
FOR EACH ROW EXECUTE FUNCTION preserve_import_target_reservation();

CREATE TABLE slack_import_job (
    id uuid PRIMARY KEY,
    team_id uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    -- Historical actor identity survives account deletion; workers reauthorize it.
    user_id text NOT NULL,
    idempotency_token uuid NOT NULL,
    -- Canonical semantic create payload hash, including full selected metadata.
    request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    source_workspace_id text CHECK (source_workspace_id ~ '^T[A-Z0-9]{1,63}$'),
    confirmed_unknown boolean NOT NULL DEFAULT false,
    include_message_history boolean NOT NULL,
    status text NOT NULL DEFAULT 'uploading' CHECK (status IN (
        'uploading', 'processing', 'completed', 'completed_with_errors',
        'failed', 'cancelling', 'cancelled')),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    registered_bytes bigint NOT NULL DEFAULT 0 CHECK (registered_bytes >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    registration_closed_at timestamptz,
    finalized_at timestamptz,
    cancel_requested_at timestamptz,
    settled_at timestamptz,
    staging_expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
    UNIQUE (team_id, user_id, idempotency_token),
    CHECK (source_workspace_id IS NOT NULL OR confirmed_unknown),
    CHECK (finalized_at IS NULL OR registration_closed_at IS NOT NULL),
    CHECK (cancel_requested_at IS NULL OR registration_closed_at IS NOT NULL),
    CHECK (status NOT IN ('cancelling', 'cancelled') OR cancel_requested_at IS NOT NULL)
);
CREATE INDEX slack_import_job_team_listing_idx ON slack_import_job (team_id, id DESC);
CREATE INDEX slack_import_job_staging_expiry_idx ON slack_import_job (staging_expires_at)
    WHERE registration_closed_at IS NULL;

CREATE FUNCTION preserve_slack_import_job_request() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.id, NEW.team_id, NEW.user_id, NEW.idempotency_token, NEW.request_sha256,
        NEW.source_workspace_id, NEW.confirmed_unknown, NEW.include_message_history, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.team_id, OLD.user_id, OLD.idempotency_token, OLD.request_sha256,
        OLD.source_workspace_id, OLD.confirmed_unknown, OLD.include_message_history, OLD.created_at)
       OR (OLD.registration_closed_at IS NOT NULL AND
           NEW.registration_closed_at IS DISTINCT FROM OLD.registration_closed_at) THEN
        RAISE EXCEPTION 'import request or registration closure is immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_slack_import_job_request
BEFORE UPDATE ON slack_import_job
FOR EACH ROW EXECUTE FUNCTION preserve_slack_import_job_request();

CREATE TABLE slack_import_conversation (
    job_id uuid NOT NULL REFERENCES slack_import_job (id) ON DELETE CASCADE,
    slack_channel_id text NOT NULL CHECK (slack_channel_id ~ '^[CGD][A-Z0-9]{1,63}$'),
    kind text NOT NULL CHECK (kind IN ('public_channel', 'private_channel', 'direct_message', 'group_direct_message')),
    name text NOT NULL,
    folder text NOT NULL,
    member_ids text[] NOT NULL,
    creator_id text,
    -- Exact source microseconds, never floating point; absence is meaningful.
    source_created_at bigint CHECK (source_created_at BETWEEN 0 AND 253402300799999999),
    resolved_created_at timestamptz,
    archived boolean NOT NULL,
    message_count bigint CHECK (message_count >= 0),
    channel_id uuid REFERENCES comms_channels (id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'awaiting_uploads' CHECK (status IN (
        'awaiting_uploads', 'queued', 'importing', 'completed', 'failed', 'skipped')),
    sealed_at timestamptz,
    part_count integer CHECK (part_count >= 0),
    manifest_sha256 text CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
    processed bigint NOT NULL DEFAULT 0 CHECK (processed >= 0),
    imported bigint NOT NULL DEFAULT 0 CHECK (imported >= 0),
    duplicates bigint NOT NULL DEFAULT 0 CHECK (duplicates >= 0),
    skipped bigint NOT NULL DEFAULT 0 CHECK (skipped >= 0),
    reactions bigint NOT NULL DEFAULT 0 CHECK (reactions >= 0),
    checkpoint_part integer NOT NULL DEFAULT 0 CHECK (checkpoint_part >= 0),
    checkpoint_record integer NOT NULL DEFAULT 0 CHECK (checkpoint_record >= 0),
    lease_owner uuid,
    lease_token uuid,
    lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
    lease_expires_at timestamptz,
    heartbeat_at timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    event_generation bigint NOT NULL DEFAULT 0 CHECK (event_generation >= 0),
    search_state text NOT NULL DEFAULT 'not_needed' CHECK (search_state IN (
        'not_needed', 'pending', 'submitted', 'completed', 'failed')),
    search_dirty_generation bigint NOT NULL DEFAULT 0 CHECK (search_dirty_generation >= 0),
    search_submitted_generation bigint CHECK (search_submitted_generation >= 0),
    search_receipt_id uuid,
    search_updated_at timestamptz NOT NULL DEFAULT now(),
    search_attempts integer NOT NULL DEFAULT 0 CHECK (search_attempts >= 0),
    -- Only sanitized domain error/warning codes, never provider diagnostics.
    last_error text,
    warnings text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    settled_at timestamptz,
    PRIMARY KEY (job_id, slack_channel_id),
    CHECK (processed = imported + duplicates + skipped),
    CHECK (num_nonnulls(sealed_at, part_count, manifest_sha256) IN (0, 3)),
    CHECK (num_nonnulls(lease_owner, lease_token, lease_expires_at, heartbeat_at) IN (0, 4)),
    CHECK ((status = 'importing') = (lease_token IS NOT NULL)),
    CHECK (status <> 'importing' OR (lease_generation > 0 AND attempts > 0)),
    CHECK (part_count IS NULL OR checkpoint_part <= part_count),
    CHECK (part_count IS NULL OR checkpoint_part <> part_count OR checkpoint_record = 0),
    CHECK (search_submitted_generation <= search_dirty_generation),
    CHECK (search_state <> 'submitted' OR
        (search_receipt_id IS NOT NULL AND search_submitted_generation IS NOT NULL))
);
CREATE INDEX slack_import_conversation_expired_lease_idx
    ON slack_import_conversation (lease_expires_at) WHERE status = 'importing';
CREATE INDEX slack_import_conversation_search_idx
    ON slack_import_conversation (search_updated_at) WHERE search_state IN ('pending', 'submitted', 'failed');
CREATE INDEX slack_import_conversation_channel_idx ON slack_import_conversation (channel_id)
    WHERE channel_id IS NOT NULL;

-- One users object and a natural key for each selected conversation part. NULL
-- channel/index identify users, not a synthetic Slack ID or negative part index.
-- S3 lifecycle expires BYTES after 14 days; retain descriptors with the receipt
-- until job cleanup. No staging cleanup may delete provenance or message maps.
CREATE TABLE slack_import_upload (
    job_id uuid NOT NULL REFERENCES slack_import_job (id) ON DELETE CASCADE,
    slack_channel_id text,
    part_index integer CHECK (part_index >= 0),
    object_key text NOT NULL UNIQUE CHECK (length(object_key) BETWEEN 1 AND 1024),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    byte_length bigint NOT NULL CHECK (byte_length > 0),
    record_count integer CHECK (record_count > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz,
    verified_version_id text CHECK (length(verified_version_id) > 0),
    verified_etag text CHECK (length(verified_etag) > 0),
    UNIQUE (job_id, slack_channel_id, part_index),
    FOREIGN KEY (job_id, slack_channel_id)
        REFERENCES slack_import_conversation (job_id, slack_channel_id) ON DELETE CASCADE,
    CHECK (num_nonnulls(slack_channel_id, part_index, record_count) IN (0, 3)),
    CHECK ((verified_at IS NOT NULL) =
        (verified_version_id IS NOT NULL OR verified_etag IS NOT NULL))
);

-- PostgreSQL 14 does not support UNIQUE NULLS NOT DISTINCT. The check above
-- requires channel/index to be both present or both absent, so the ordinary
-- unique constraint covers conversation parts and this index covers users.
CREATE UNIQUE INDEX slack_import_upload_one_users_per_job
    ON slack_import_upload (job_id) WHERE slack_channel_id IS NULL;

-- Lock job before conversation in every registration/seal transaction. This
-- makes a concurrent seal/finalize and registration serialize on the same row.
CREATE FUNCTION protect_slack_import_upload() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    job slack_import_job;
    seal_time timestamptz;
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Cascading job cleanup is allowed; independent descriptor deletion is not.
        IF EXISTS (SELECT 1 FROM slack_import_job WHERE id = OLD.job_id) THEN
            RAISE EXCEPTION 'import descriptors cannot be deleted' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    SELECT * INTO job FROM slack_import_job WHERE id = NEW.job_id FOR UPDATE;
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.job_id, NEW.slack_channel_id, NEW.part_index, NEW.object_key,
            NEW.sha256, NEW.byte_length, NEW.record_count, NEW.created_at)
           IS DISTINCT FROM
           (OLD.job_id, OLD.slack_channel_id, OLD.part_index, OLD.object_key,
            OLD.sha256, OLD.byte_length, OLD.record_count, OLD.created_at)
           OR (OLD.verified_at IS NOT NULL AND
               (NEW.verified_at, NEW.verified_version_id, NEW.verified_etag) IS DISTINCT FROM
               (OLD.verified_at, OLD.verified_version_id, OLD.verified_etag)) THEN
            RAISE EXCEPTION 'import descriptor or verification is immutable' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW IS NOT DISTINCT FROM OLD THEN
            RETURN NEW;
        END IF;
    END IF;
    IF job.registration_closed_at IS NOT NULL THEN
        RAISE EXCEPTION 'import registration is closed' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.slack_channel_id IS NOT NULL THEN
        SELECT sealed_at INTO seal_time FROM slack_import_conversation
        WHERE job_id = NEW.job_id AND slack_channel_id = NEW.slack_channel_id FOR UPDATE;
        IF seal_time IS NOT NULL OR NOT job.include_message_history THEN
            RAISE EXCEPTION 'import manifest is sealed or history disabled' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_slack_import_upload
BEFORE INSERT OR UPDATE OR DELETE ON slack_import_upload
FOR EACH ROW EXECUTE FUNCTION protect_slack_import_upload();

CREATE FUNCTION protect_slack_import_conversation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    expected_count integer;
    last_index integer;
    expected_hash text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF num_nonnulls(NEW.sealed_at, NEW.part_count, NEW.manifest_sha256) > 0 THEN
            RAISE EXCEPTION 'create conversation before sealing its manifest' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF (NEW.job_id, NEW.slack_channel_id, NEW.kind, NEW.name, NEW.folder,
        NEW.member_ids, NEW.creator_id, NEW.source_created_at, NEW.archived, NEW.message_count)
       IS DISTINCT FROM
       (OLD.job_id, OLD.slack_channel_id, OLD.kind, OLD.name, OLD.folder,
        OLD.member_ids, OLD.creator_id, OLD.source_created_at, OLD.archived, OLD.message_count)
       OR (OLD.sealed_at IS NOT NULL AND
           (NEW.sealed_at, NEW.part_count, NEW.manifest_sha256) IS DISTINCT FROM
           (OLD.sealed_at, OLD.part_count, OLD.manifest_sha256))
       OR (OLD.resolved_created_at IS NOT NULL AND
           NEW.resolved_created_at IS DISTINCT FROM OLD.resolved_created_at) THEN
        RAISE EXCEPTION 'import metadata or seal is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.sealed_at IS NULL AND NEW.sealed_at IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM slack_import_job
                   WHERE id = NEW.job_id AND registration_closed_at IS NOT NULL) THEN
            RAISE EXCEPTION 'import registration is closed' USING ERRCODE = 'check_violation';
        END IF;
        SELECT count(*), max(part_index),
            encode(digest(coalesce(string_agg(
                part_index::text || ':' || sha256 || ':' || byte_length::text || ':' || record_count::text || E'\n',
                '' ORDER BY part_index), ''), 'sha256'), 'hex')
        INTO expected_count, last_index, expected_hash
        FROM slack_import_upload WHERE job_id = NEW.job_id AND slack_channel_id = NEW.slack_channel_id;
        IF NEW.part_count IS DISTINCT FROM expected_count
           OR (expected_count > 0 AND last_index <> expected_count - 1)
           OR NEW.manifest_sha256 IS DISTINCT FROM expected_hash THEN
            RAISE EXCEPTION 'import seal does not match descriptors' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_slack_import_conversation
BEFORE INSERT OR UPDATE ON slack_import_conversation
FOR EACH ROW EXECUTE FUNCTION protect_slack_import_conversation();

CREATE TABLE slack_import_outbox (
    job_id uuid NOT NULL,
    slack_channel_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('import', 'search')),
    generation bigint NOT NULL CHECK (generation > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    available_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    cancelled_at timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error text,
    PRIMARY KEY (job_id, slack_channel_id, kind, generation),
    FOREIGN KEY (job_id, slack_channel_id)
        REFERENCES slack_import_conversation (job_id, slack_channel_id) ON DELETE CASCADE,
    CHECK (num_nonnulls(published_at, cancelled_at) <= 1)
);
CREATE INDEX slack_import_outbox_pending_idx ON slack_import_outbox (available_at, created_at)
    WHERE published_at IS NULL AND cancelled_at IS NULL;

-- No job FK: first-commit-wins dedupe survives every job/staging cleanup. Soft
-- message deletion retains the mapping; hard deletion deliberately removes it.
-- The deferred composite FK permits mapping-before-message writes in one batch
-- and proves that the mapped message actually belongs to the recorded channel.
CREATE TABLE slack_import_message_map (
    team_id uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    slack_channel_id text NOT NULL CHECK (slack_channel_id ~ '^[CGD][A-Z0-9]{1,63}$'),
    slack_ts bigint NOT NULL CHECK (slack_ts BETWEEN 0 AND 253402300799999999),
    message_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    parent_entity_type text GENERATED ALWAYS AS ('channel'::text) STORED,
    parent_entity_id text GENERATED ALWAYS AS (channel_id::text) STORED,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, slack_channel_id, slack_ts),
    FOREIGN KEY (message_id, parent_entity_type, parent_entity_id)
        REFERENCES comms_messages (id, parent_entity_type, parent_entity_id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX slack_import_message_map_message_idx ON slack_import_message_map (message_id);

-- Additive compatibility: deployed onboarding/chat writers keep their defaults,
-- insert shapes, and per-user uniqueness. Do not alter channel team/private rules.
ALTER TABLE import_entity DROP CONSTRAINT import_entity_initiator_check;
ALTER TABLE import_entity ADD CONSTRAINT import_entity_initiator_check
    CHECK (initiator IN ('onboarding', 'chat', 'archive'));
