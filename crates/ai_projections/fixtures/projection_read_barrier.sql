-- Release the reader's session lock only after its INSERT snapshot exists.
-- The controlling transaction can then commit a claim before releasing the
-- conflicting instance row. This models a worker starting during an upsert.
CREATE FUNCTION release_projection_reader_barrier() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('application_name') = 'projection-concurrent-reader' THEN
        PERFORM pg_advisory_unlock(710471789::bigint);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER projection_reader_barrier
BEFORE INSERT ON user_ai_projection
FOR EACH ROW EXECUTE FUNCTION release_projection_reader_barrier();
