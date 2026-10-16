-- Run after migration 20260930171728 on PostgreSQL 14 and 16:
-- psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/slack_archive_unique_keys.sql
BEGIN;

-- Copy the real indexes and checks, without the unrelated job/FK/trigger setup.
-- Allow a NULL record_count here to exercise NULL-key uniqueness independently
-- of the original migration's upload validation.
CREATE TEMP TABLE upload_keys (LIKE slack_import_upload INCLUDING ALL);
ALTER TABLE upload_keys ALTER COLUMN record_count DROP NOT NULL;

INSERT INTO upload_keys (job_id, object_key, sha256, byte_length)
VALUES ('00000000-0000-0000-0000-000000000001', 'users', repeat('a', 64), 1);

DO $$
BEGIN
    BEGIN
        INSERT INTO upload_keys (job_id, object_key, sha256, byte_length)
        VALUES ('00000000-0000-0000-0000-000000000001', 'other-users', repeat('a', 64), 1);
        RAISE EXCEPTION 'duplicate NULL upload key was accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
END;
$$;

-- A different job can still register its own users object.
INSERT INTO upload_keys (job_id, object_key, sha256, byte_length)
VALUES ('00000000-0000-0000-0000-000000000002', 'second-job-users', repeat('a', 64), 1);

INSERT INTO upload_keys (job_id, slack_channel_id, part_index, object_key, sha256, byte_length, record_count)
VALUES ('00000000-0000-0000-0000-000000000001', 'C123', 0, 'part-0', repeat('a', 64), 1, 1);

DO $$
BEGIN
    BEGIN
        INSERT INTO upload_keys (job_id, slack_channel_id, part_index, object_key, sha256, byte_length, record_count)
        VALUES ('00000000-0000-0000-0000-000000000001', 'C123', 0, 'other-part-0', repeat('a', 64), 1, 1);
        RAISE EXCEPTION 'duplicate conversation part was accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
END;
$$;

-- Preserve the conflict target used by the existing upload adapter.
INSERT INTO upload_keys (job_id, slack_channel_id, part_index, object_key, sha256, byte_length, record_count)
VALUES ('00000000-0000-0000-0000-000000000001', 'C123', 0, 'retry-part-0', repeat('a', 64), 1, 1)
ON CONFLICT (job_id, slack_channel_id, part_index) DO NOTHING;

INSERT INTO upload_keys (job_id, slack_channel_id, part_index, object_key, sha256, byte_length, record_count)
VALUES ('00000000-0000-0000-0000-000000000001', 'C123', 1, 'part-1', repeat('a', 64), 1, 1);

DO $$
BEGIN
    ASSERT (SELECT count(*) = 4 FROM upload_keys), 'valid upload keys did not remain distinct';
END;
$$;

ROLLBACK;
