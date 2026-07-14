DROP TRIGGER IF EXISTS trg_ecsi_contact_name_update ON email_contacts;
DROP TRIGGER IF EXISTS trg_ecsi_message_delete ON email_messages;
DROP TRIGGER IF EXISTS trg_ecsi_message_recipient_delete ON email_message_recipients;
DROP TRIGGER IF EXISTS trg_ecsi_message_recipient ON email_message_recipients;
DROP TRIGGER IF EXISTS trg_ecsi_message_from ON email_messages;

DROP FUNCTION IF EXISTS ecsi_update_contact_name();
DROP FUNCTION IF EXISTS ecsi_delete_message();
DROP FUNCTION IF EXISTS ecsi_delete_recipient();
DROP FUNCTION IF EXISTS ecsi_populate_recipient();
DROP FUNCTION IF EXISTS ecsi_populate_from();

DROP TABLE IF EXISTS email_contact_search_index;
