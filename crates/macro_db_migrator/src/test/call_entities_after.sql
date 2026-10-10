DO $$ BEGIN
    ASSERT (SELECT count(*) FROM call_entities WHERE created_via = 'native') = 3;
    ASSERT (SELECT started_at FROM call_entities WHERE id = '019a0000-0000-7000-8000-000000000010') = '2026-01-01T10:00:00Z'::timestamptz;
    ASSERT (SELECT title FROM call_entities WHERE id = '019a0000-0000-7000-8000-000000000011') = 'Existing call';
END $$;
DELETE FROM calls WHERE id = '019a0000-0000-7000-8000-000000000012';

-- Calls created after deployment also receive a durable identity immediately.
INSERT INTO "SharePermission" (id) VALUES ('call-model-new');
INSERT INTO calls (id, room_name, created_by, share_permission_id, created_at) VALUES
('019a0000-0000-7000-8000-000000000013', 'new-native-room', 'macro|call-model-a@test.com', 'call-model-new', '2026-01-02T10:00:00Z');
DO $$ BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM call_entities
        WHERE id = '019a0000-0000-7000-8000-000000000013'
            AND user_id = 'macro|call-model-a@test.com'
            AND created_via = 'native'
            AND started_at = '2026-01-02T10:00:00Z'::timestamptz
            AND share_permission_id = 'call-model-new'
    );
END $$;
INSERT INTO call_records (id, room_name, created_by, share_permission_id, started_at, ended_at, duration_ms)
SELECT id, room_name, created_by, share_permission_id, created_at, '2026-01-02T10:05:00Z', 300000 FROM calls
WHERE id = '019a0000-0000-7000-8000-000000000013';
DELETE FROM calls WHERE id = '019a0000-0000-7000-8000-000000000013';
DO $$ BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM call_entities
        WHERE id = '019a0000-0000-7000-8000-000000000013'
            AND ended_at = '2026-01-02T10:05:00Z'::timestamptz
            AND duration_ms = 300000
            AND share_permission_id = 'call-model-new'
    );
END $$;
DELETE FROM call_records WHERE id = '019a0000-0000-7000-8000-000000000013';
DO $$ BEGIN
    ASSERT NOT EXISTS (SELECT 1 FROM call_entities WHERE id = '019a0000-0000-7000-8000-000000000013');
    ASSERT NOT EXISTS (SELECT 1 FROM "SharePermission" WHERE id = 'call-model-new');
END $$;

-- Old service writers update the new identity without changing native IDs.
UPDATE call_records SET custom_name = 'Renamed call' WHERE id = '019a0000-0000-7000-8000-000000000011';
INSERT INTO call_records (id, room_name, created_by, share_permission_id, started_at, ended_at, duration_ms)
SELECT id, room_name, created_by, share_permission_id, created_at, '2026-01-01T10:05:00Z', 300000 FROM calls
WHERE id = '019a0000-0000-7000-8000-000000000010';
DELETE FROM calls WHERE id = '019a0000-0000-7000-8000-000000000010';
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM call_entities WHERE created_via = 'native') = 2;
    ASSERT (SELECT duration_ms FROM call_entities WHERE id = '019a0000-0000-7000-8000-000000000010') = 300000;
    ASSERT (SELECT title FROM call_entities WHERE id = '019a0000-0000-7000-8000-000000000011') = 'Renamed call';
END $$;

-- Bare manual/imported records require no room, people, media, or timing.
INSERT INTO "SharePermission" (id) VALUES ('call-model-import-a'), ('call-model-import-b');
INSERT INTO call_entities (id, user_id, created_via, share_permission_id) VALUES
('019a0000-0000-7000-8000-000000000020', 'macro|call-model-a@test.com', 'import', 'call-model-import-a'),
('019a0000-0000-7000-8000-000000000021', 'macro|call-model-b@test.com', 'manual', 'call-model-import-b');
INSERT INTO call_entity_sources (call_id, user_id, namespace, provider, object_type, external_id) VALUES
('019a0000-0000-7000-8000-000000000020', 'macro|call-model-a@test.com', 'account-1', 'granola', 'note', 'opaque:/note#one'),
('019a0000-0000-7000-8000-000000000021', 'macro|call-model-b@test.com', 'account-1', 'granola', 'note', 'opaque:/note#one');
DO $$ BEGIN
    ASSERT (SELECT started_at IS NULL AND ended_at IS NULL AND duration_ms IS NULL FROM call_entities WHERE id = '019a0000-0000-7000-8000-000000000020');
    BEGIN
        INSERT INTO call_entity_sources (call_id, user_id, namespace, provider, object_type, external_id) VALUES
        ('019a0000-0000-7000-8000-000000000021', 'macro|call-model-a@test.com', 'account-1', 'granola', 'note', 'opaque:/note#one');
        RAISE EXCEPTION 'duplicate source identity was accepted';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    BEGIN
        UPDATE call_entities SET duration_ms = -1 WHERE id = '019a0000-0000-7000-8000-000000000020';
        RAISE EXCEPTION 'negative duration was accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
        UPDATE call_entities SET started_at = '2026-01-02', ended_at = '2026-01-01' WHERE id = '019a0000-0000-7000-8000-000000000020';
        RAISE EXCEPTION 'reversed call bounds were accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

INSERT INTO call_entity_participants (call_id, id) VALUES
('019a0000-0000-7000-8000-000000000020', '019a0000-0000-7000-8000-000000000030');
INSERT INTO call_entity_attendance (call_id, participant_id, id, joined_at, left_at) VALUES
('019a0000-0000-7000-8000-000000000020', '019a0000-0000-7000-8000-000000000030', '019a0000-0000-7000-8000-000000000031', '2026-01-01T12:00:00Z', '2026-01-01T12:01:00Z'),
('019a0000-0000-7000-8000-000000000020', '019a0000-0000-7000-8000-000000000030', '019a0000-0000-7000-8000-000000000032', '2026-01-01T12:02:00Z', NULL);
INSERT INTO call_entity_recordings (call_id, id, media_type, storage_key) VALUES
('019a0000-0000-7000-8000-000000000020', '019a0000-0000-7000-8000-000000000040', 'audio', 'calls/recording.wav');
INSERT INTO call_entity_recordings (call_id, id, media_type, external_url) VALUES
('019a0000-0000-7000-8000-000000000020', '019a0000-0000-7000-8000-000000000041', 'video', 'https://provider.test/recording');
INSERT INTO call_entity_transcripts (call_id, id, recording_id) VALUES
('019a0000-0000-7000-8000-000000000020', '019a0000-0000-7000-8000-000000000050', NULL),
('019a0000-0000-7000-8000-000000000020', '019a0000-0000-7000-8000-000000000051', '019a0000-0000-7000-8000-000000000040');
INSERT INTO call_entity_transcript_segments (call_id, transcript_id, sequence_num, content, participant_id) VALUES
('019a0000-0000-7000-8000-000000000020', '019a0000-0000-7000-8000-000000000050', 0, 'Unknown speaker and timing', NULL),
('019a0000-0000-7000-8000-000000000020', '019a0000-0000-7000-8000-000000000050', 1, 'Known speaker, unknown timing', '019a0000-0000-7000-8000-000000000030');
DO $$ BEGIN
    BEGIN
        INSERT INTO call_entity_transcripts (call_id, id, recording_id) VALUES
        ('019a0000-0000-7000-8000-000000000021', '019a0000-0000-7000-8000-000000000052', '019a0000-0000-7000-8000-000000000040');
        SET CONSTRAINTS ALL IMMEDIATE;
        RAISE EXCEPTION 'cross-call recording reference was accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
        INSERT INTO call_entity_transcript_segments (call_id, transcript_id, sequence_num, content, start_ms, end_ms) VALUES
        ('019a0000-0000-7000-8000-000000000020', '019a0000-0000-7000-8000-000000000050', 2, 'Invalid', 2000, 1000);
        RAISE EXCEPTION 'reversed offsets were accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
        UPDATE call_entity_recordings SET external_url = 'https://provider.test/also' WHERE id = '019a0000-0000-7000-8000-000000000040';
        RAISE EXCEPTION 'ambiguous recording locator was accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- Deleting people/media must preserve independently useful transcript text.
DELETE FROM call_entity_participants WHERE id = '019a0000-0000-7000-8000-000000000030';
DELETE FROM call_entity_recordings WHERE id = '019a0000-0000-7000-8000-000000000040';
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM call_entity_transcript_segments) = 2;
    ASSERT (SELECT count(*) FROM call_entity_transcript_segments WHERE participant_id IS NOT NULL) = 0;
    ASSERT (SELECT count(*) FROM call_entity_attendance) = 0;
    ASSERT (SELECT recording_id IS NULL FROM call_entity_transcripts WHERE id = '019a0000-0000-7000-8000-000000000051');
END $$;

-- Both legacy deletion and entity deletion clean permissions and child rows.
-- Include references still attached when the owning call is deleted.
INSERT INTO call_entity_transcripts (call_id, id, recording_id) VALUES
('019a0000-0000-7000-8000-000000000020', '019a0000-0000-7000-8000-000000000052', '019a0000-0000-7000-8000-000000000041');
INSERT INTO call_entity_participants (call_id, id) VALUES
('019a0000-0000-7000-8000-000000000020', '019a0000-0000-7000-8000-000000000033');
INSERT INTO call_entity_transcript_segments (call_id, transcript_id, sequence_num, content, participant_id) VALUES
('019a0000-0000-7000-8000-000000000020', '019a0000-0000-7000-8000-000000000050', 2, 'Still attached', '019a0000-0000-7000-8000-000000000033');
DELETE FROM call_records WHERE id = '019a0000-0000-7000-8000-000000000010';
DELETE FROM call_entities WHERE id IN ('019a0000-0000-7000-8000-000000000011', '019a0000-0000-7000-8000-000000000020');
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM call_entities) = 1;
    ASSERT (SELECT count(*) FROM call_records) = 0;
    ASSERT (SELECT count(*) FROM call_entity_recordings) = 0;
    ASSERT (SELECT count(*) FROM call_entity_transcripts) = 0;
    ASSERT (SELECT count(*) FROM call_entity_transcript_segments) = 0;
    ASSERT (SELECT count(*) FROM call_entity_sources) = 1;
    ASSERT NOT EXISTS (SELECT 1 FROM "SharePermission" WHERE id IN ('call-model-live', 'call-model-archive', 'call-model-import-a'));
END $$;

DELETE FROM "User" WHERE id = 'macro|call-model-b@test.com';
DO $$ BEGIN
    ASSERT NOT EXISTS (SELECT 1 FROM call_entities);
    ASSERT NOT EXISTS (SELECT 1 FROM call_entity_sources);
    ASSERT NOT EXISTS (SELECT 1 FROM "SharePermission" WHERE id = 'call-model-import-b');
END $$;
