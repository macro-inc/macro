DELETE FROM email_message_labels WHERE message_id = ANY($1) AND label_id = ( SELECT id FROM email_labels WHERE link_id = $2 AND provider_label_id = $3 )
