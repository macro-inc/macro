-- Execute with a migration/admin identity; create and provision the LOGIN role
-- separately through the normal secrets process. Do not give it schema ownership.
GRANT USAGE ON SCHEMA public TO whatsapp_session;
GRANT SELECT(id,user_id,state,authorization_generation) ON whatsapp_linked_account TO whatsapp_session;
GRANT SELECT, INSERT, UPDATE ON whatsapp_session_owner TO whatsapp_session;
GRANT SELECT, INSERT, UPDATE ON whatsapp_transport_outcome TO whatsapp_session;
