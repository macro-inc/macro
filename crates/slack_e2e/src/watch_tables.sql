-- Statement triggers that wake slack_e2e::wait_for_rows. Test databases only.
CREATE OR REPLACE FUNCTION e2e_notify_changed() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('e2e_changed', TG_TABLE_NAME);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON slack_account
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON slack_login_attempt
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON slack_conversation
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON slack_send
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON slack_read_mark
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON external_chat
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON external_chat_message
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON external_chat_reaction
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON external_chat_read_state
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON external_chat_attachment
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
