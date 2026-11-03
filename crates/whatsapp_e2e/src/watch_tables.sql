-- Statement triggers that wake whatsapp_e2e::wait_for_rows. Test databases only.
CREATE OR REPLACE FUNCTION e2e_notify_changed() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('e2e_changed', TG_TABLE_NAME);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON whatsapp_linked_account
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON whatsapp_pairing
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON whatsapp_roster
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON external_chat
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON whatsapp_chat_membership
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON external_chat_message
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON whatsapp_message_observation
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON whatsapp_inbound_event
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON whatsapp_send
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON external_chat_attachment
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON whatsapp_chat
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON external_chat_poll_vote
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
CREATE TRIGGER e2e_changed AFTER INSERT OR UPDATE OR DELETE ON whatsapp_lookup
    FOR EACH STATEMENT EXECUTE FUNCTION e2e_notify_changed();
