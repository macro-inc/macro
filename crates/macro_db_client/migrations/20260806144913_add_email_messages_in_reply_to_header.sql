ALTER TABLE email_messages
ADD COLUMN in_reply_to_message_id_header TEXT;

COMMENT ON COLUMN email_messages.in_reply_to_message_id_header IS
    'Stored In-Reply-To header; legacy NULL rows use the headers_jsonb runtime fallback.';
