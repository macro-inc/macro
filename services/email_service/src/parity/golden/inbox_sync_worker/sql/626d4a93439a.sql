DELETE FROM email_message_labels WHERE message_id = $1 AND label_id IN ( SELECT id FROM email_labels WHERE link_id = $2 AND provider_label_id = ANY($3) )
