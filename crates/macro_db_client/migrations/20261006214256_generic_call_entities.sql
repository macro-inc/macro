-- Durable identity for native sessions and records imported without an RTC room.
-- Existing native tables remain the runtime/archive storage during the rollout.
-- Prevent native writes between the backfill snapshot and trigger installation.
SET LOCAL lock_timeout = '5s';
LOCK TABLE calls, call_records IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE call_entities (
    id UUID PRIMARY KEY,
    -- Preserve legacy call owners even when their account row no longer exists.
    -- Account deletion below explicitly cleans entities whose owner still exists.
    user_id TEXT NOT NULL,
    title TEXT,
    created_via TEXT NOT NULL CHECK (created_via IN ('native', 'import', 'upload', 'manual')),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_ms BIGINT CHECK (duration_ms >= 0),
    channel_id UUID REFERENCES comms_channels(id) ON DELETE SET NULL,
    meeting_id UUID REFERENCES call_meetings(id) ON DELETE SET NULL,
    share_permission_id TEXT NOT NULL REFERENCES "SharePermission"(id) DEFERRABLE INITIALLY DEFERRED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ended_at >= started_at)
);
CREATE INDEX call_entities_user_created_idx ON call_entities(user_id, created_at DESC, id);
CREATE INDEX call_entities_channel_idx ON call_entities(channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX call_entities_meeting_idx ON call_entities(meeting_id) WHERE meeting_id IS NOT NULL;
CREATE INDEX call_entities_share_permission_idx ON call_entities(share_permission_id);

-- A namespace is a stable provider-account identity, not a rotating credential.
-- The user is part of the key: imports from different users never silently merge.
CREATE TABLE call_entity_sources (
    call_id UUID NOT NULL REFERENCES call_entities(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    namespace TEXT NOT NULL CHECK (length(btrim(namespace)) > 0),
    provider TEXT NOT NULL CHECK (length(btrim(provider)) > 0),
    object_type TEXT NOT NULL CHECK (length(btrim(object_type)) > 0),
    external_id TEXT NOT NULL CHECK (length(external_id) > 0),
    external_url TEXT,
    external_updated_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
    PRIMARY KEY (user_id, namespace, provider, object_type, external_id)
);
CREATE INDEX call_entity_sources_call_idx ON call_entity_sources(call_id);

-- A call-local speaker need not be a Macro account or even have a known name.
CREATE TABLE call_entity_participants (
    call_id UUID NOT NULL REFERENCES call_entities(id) ON DELETE CASCADE,
    id UUID NOT NULL,
    user_id TEXT REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL,
    display_name TEXT,
    email TEXT,
    phone TEXT,
    external_id TEXT,
    PRIMARY KEY (call_id, id)
);
CREATE INDEX call_entity_participants_user_idx ON call_entity_participants(user_id) WHERE user_id IS NOT NULL;

-- Multiple intervals preserve reconnects; an identified speaker need not have any.
CREATE TABLE call_entity_attendance (
    call_id UUID NOT NULL,
    participant_id UUID NOT NULL,
    id UUID NOT NULL,
    joined_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,
    PRIMARY KEY (call_id, participant_id, id),
    FOREIGN KEY (call_id, participant_id) REFERENCES call_entity_participants(call_id, id) ON DELETE CASCADE,
    CHECK (left_at >= joined_at),
    CHECK (joined_at IS NOT NULL OR left_at IS NOT NULL)
);

-- Multiple independent audio/video assets, including externally hosted assets.
-- Persist stable object keys or provider URLs, never signed playback URLs.
CREATE TABLE call_entity_recordings (
    call_id UUID NOT NULL REFERENCES call_entities(id) ON DELETE CASCADE,
    id UUID NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('audio', 'video')),
    storage_key TEXT,
    external_url TEXT,
    mime_type TEXT,
    duration_ms BIGINT CHECK (duration_ms >= 0),
    started_at TIMESTAMPTZ,
    PRIMARY KEY (call_id, id),
    CHECK ((storage_key IS NOT NULL)::int + (external_url IS NOT NULL)::int = 1),
    CHECK (storage_key IS NULL OR length(storage_key) > 0),
    CHECK (external_url IS NULL OR length(external_url) > 0)
);

-- A transcript can exist without a recording, and multiple versions/languages
-- can coexist. Offsets below are relative to this transcript, not the call clock.
CREATE TABLE call_entity_transcripts (
    call_id UUID NOT NULL REFERENCES call_entities(id) ON DELETE CASCADE,
    id UUID NOT NULL,
    recording_id UUID,
    language TEXT,
    provider TEXT,
    started_at TIMESTAMPTZ,
    PRIMARY KEY (call_id, id),
    FOREIGN KEY (call_id, recording_id) REFERENCES call_entity_recordings(call_id, id)
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX call_entity_transcripts_recording_idx ON call_entity_transcripts(call_id, recording_id) WHERE recording_id IS NOT NULL;

CREATE TABLE call_entity_transcript_segments (
    call_id UUID NOT NULL,
    transcript_id UUID NOT NULL,
    sequence_num INTEGER NOT NULL CHECK (sequence_num >= 0),
    participant_id UUID,
    speaker_label TEXT,
    content TEXT NOT NULL,
    start_ms BIGINT CHECK (start_ms >= 0),
    end_ms BIGINT CHECK (end_ms >= 0),
    PRIMARY KEY (call_id, transcript_id, sequence_num),
    FOREIGN KEY (call_id, transcript_id) REFERENCES call_entity_transcripts(call_id, id) ON DELETE CASCADE,
    FOREIGN KEY (call_id, participant_id) REFERENCES call_entity_participants(call_id, id)
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
    CHECK (end_ms >= start_ms)
);
CREATE INDEX call_entity_segments_participant_idx ON call_entity_transcript_segments(call_id, participant_id) WHERE participant_id IS NOT NULL;

-- PostgreSQL 14 cannot SET NULL on just one column of a composite foreign key.
-- Detach optional references explicitly, retaining the non-null call scope.
CREATE FUNCTION detach_call_entity_recording() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- During whole-call deletion the children are already being cascaded away.
    IF EXISTS (SELECT 1 FROM call_entities WHERE id = OLD.call_id) THEN
        UPDATE call_entity_transcripts SET recording_id = NULL
        WHERE call_id = OLD.call_id AND recording_id = OLD.id;
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER detach_call_entity_recording AFTER DELETE ON call_entity_recordings
FOR EACH ROW EXECUTE FUNCTION detach_call_entity_recording();

CREATE FUNCTION detach_call_entity_participant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM call_entities WHERE id = OLD.call_id) THEN
        UPDATE call_entity_transcript_segments SET participant_id = NULL
        WHERE call_id = OLD.call_id AND participant_id = OLD.id;
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER detach_call_entity_participant AFTER DELETE ON call_entity_participants
FOR EACH ROW EXECUTE FUNCTION detach_call_entity_participant();

-- Preserve existing IDs, owner grants, share permissions, and call permalinks.
INSERT INTO call_entities (id, user_id, title, created_via, started_at, ended_at, duration_ms,
    channel_id, meeting_id, share_permission_id, created_at)
SELECT id, created_by, custom_name, 'native', started_at, ended_at, duration_ms,
    channel_id, meeting_id, share_permission_id, started_at
FROM call_records
ON CONFLICT (id) DO NOTHING;
INSERT INTO call_entities (id, user_id, created_via, started_at, channel_id, meeting_id, share_permission_id, created_at)
SELECT id, created_by, 'native', created_at, channel_id, meeting_id, share_permission_id, created_at
FROM calls
ON CONFLICT (id) DO NOTHING;

-- Keep old service versions writing native identity throughout the rollout.
-- Native participants/media/transcripts remain in their existing tables; they
-- are not duplicated into the imported-artifact tables above.
CREATE FUNCTION sync_native_call_entity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'calls' THEN
        INSERT INTO call_entities (id, user_id, created_via, started_at, channel_id, meeting_id, share_permission_id, created_at)
        VALUES (NEW.id, NEW.created_by, 'native', NEW.created_at, NEW.channel_id, NEW.meeting_id, NEW.share_permission_id, NEW.created_at)
        ON CONFLICT (id) DO UPDATE SET
            channel_id = EXCLUDED.channel_id, meeting_id = EXCLUDED.meeting_id,
            share_permission_id = EXCLUDED.share_permission_id, updated_at = now();
    ELSE
        INSERT INTO call_entities (id, user_id, title, created_via, started_at, ended_at, duration_ms,
            channel_id, meeting_id, share_permission_id, created_at)
        VALUES (NEW.id, NEW.created_by, NEW.custom_name, 'native', NEW.started_at, NEW.ended_at, NEW.duration_ms,
            NEW.channel_id, NEW.meeting_id, NEW.share_permission_id, NEW.started_at)
        ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title, started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at,
            duration_ms = EXCLUDED.duration_ms, channel_id = EXCLUDED.channel_id, meeting_id = EXCLUDED.meeting_id,
            share_permission_id = EXCLUDED.share_permission_id, updated_at = now();
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER sync_active_call_entity AFTER INSERT OR UPDATE ON calls
FOR EACH ROW EXECUTE FUNCTION sync_native_call_entity();
CREATE TRIGGER sync_archived_call_entity AFTER INSERT OR UPDATE ON call_records
FOR EACH ROW EXECUTE FUNCTION sync_native_call_entity();

-- Archiving inserts the record before removing the room; preserve the entity.
CREATE FUNCTION cleanup_native_call_entity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM calls WHERE id = OLD.id)
        AND NOT EXISTS (SELECT 1 FROM call_records WHERE id = OLD.id) THEN
        DELETE FROM call_entities WHERE id = OLD.id;
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER cleanup_active_call_entity AFTER DELETE ON calls
FOR EACH ROW EXECUTE FUNCTION cleanup_native_call_entity();
CREATE TRIGGER cleanup_archived_call_entity AFTER DELETE ON call_records
FOR EACH ROW EXECUTE FUNCTION cleanup_native_call_entity();

-- Entity deletion owns both runtime cleanup and private sharing state.
CREATE FUNCTION cleanup_call_entity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM calls WHERE id = OLD.id;
    DELETE FROM call_records WHERE id = OLD.id;
    DELETE FROM entity_access WHERE entity_type = 'call' AND entity_id = OLD.id;
    DELETE FROM "SharePermission" WHERE id = OLD.share_permission_id;
    RETURN OLD;
END;
$$;
CREATE TRIGGER cleanup_call_entity AFTER DELETE ON call_entities
FOR EACH ROW EXECUTE FUNCTION cleanup_call_entity();

CREATE FUNCTION cleanup_user_call_entities() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM call_entities WHERE user_id = OLD.id;
    RETURN OLD;
END;
$$;
CREATE TRIGGER cleanup_user_call_entities AFTER DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION cleanup_user_call_entities();

-- Discussions still use the existing call message parent and canonical root.
CREATE OR REPLACE FUNCTION cleanup_call_messages() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.id::text, 0));
    IF NOT EXISTS (SELECT 1 FROM call_entities WHERE id = OLD.id)
        AND NOT EXISTS (SELECT 1 FROM calls WHERE id = OLD.id)
        AND NOT EXISTS (SELECT 1 FROM call_records WHERE id = OLD.id) THEN
        DELETE FROM comms_entity_mentions
        WHERE source_entity_type = 'message' AND source_entity_id IN (
            SELECT id::text FROM comms_messages
            WHERE parent_entity_type = 'call' AND parent_entity_id = OLD.id::text
        );
        DELETE FROM comms_messages WHERE parent_entity_type = 'call' AND parent_entity_id = OLD.id::text;
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER cleanup_call_entity_messages AFTER DELETE ON call_entities
FOR EACH ROW EXECUTE FUNCTION cleanup_call_messages();
