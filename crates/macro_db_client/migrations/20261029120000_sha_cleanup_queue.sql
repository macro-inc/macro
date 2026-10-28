-- Content hashes whose last BomPart reference may be gone. sha_cleanup_worker
-- recounts "BomPart" for each one and deletes the S3 object when nothing
-- references it. Replaces the Redis `bucket:sha-delete` set and `sha:` counters.
CREATE TABLE sha_cleanup_queue (
    sha TEXT PRIMARY KEY,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
