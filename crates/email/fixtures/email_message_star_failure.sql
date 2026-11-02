-- Fail starred-state writes inside this test database, after the label write.
CREATE FUNCTION reject_message_star_state() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'starred-state test failure';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reject_message_star_state
BEFORE UPDATE OF is_starred ON email_messages
FOR EACH ROW EXECUTE FUNCTION reject_message_star_state();
