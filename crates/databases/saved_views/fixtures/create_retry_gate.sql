-- The retry releases the arrival signal, then waits until the legacy delete commits.
CREATE FUNCTION saved_view_retry_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.name = 'Racing retry' THEN
        PERFORM pg_advisory_unlock(804722);
        PERFORM pg_advisory_xact_lock(804721);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER saved_view_retry_gate
BEFORE INSERT ON saved_view
FOR EACH ROW EXECUTE FUNCTION saved_view_retry_gate();
