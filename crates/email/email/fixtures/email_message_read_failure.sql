-- Fail read-state writes inside this test database, after the label write.
CREATE FUNCTION reject_message_read_state() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'read-state test failure: message';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reject_message_read_state
BEFORE UPDATE OF is_read ON email_messages
FOR EACH ROW EXECUTE FUNCTION reject_message_read_state();
