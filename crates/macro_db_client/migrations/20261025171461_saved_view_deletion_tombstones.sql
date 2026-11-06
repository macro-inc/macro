-- Preserve physical deletion for old readers while permanently reserving retired IDs.
SET LOCAL lock_timeout = '5s';
CREATE TABLE saved_view_tombstone (id uuid PRIMARY KEY);
CREATE FUNCTION saved_view_record_deletion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- DELETE already holds the row lock. Do not acquire the application's
    -- advisory lock here: legacy deletes take these locks in the reverse order.
    INSERT INTO saved_view_tombstone (id) VALUES (OLD.id) ON CONFLICT DO NOTHING;
    RETURN OLD;
END;
$$;
CREATE TRIGGER saved_view_record_deletion
BEFORE DELETE ON saved_view
FOR EACH ROW EXECUTE FUNCTION saved_view_record_deletion();
