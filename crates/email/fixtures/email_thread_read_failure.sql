-- Fail read-state writes after both the label and message writes.
CREATE FUNCTION reject_thread_read_state() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'read-state test failure: thread';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reject_thread_read_state
BEFORE UPDATE OF is_read ON email_threads
FOR EACH ROW EXECUTE FUNCTION reject_thread_read_state();
