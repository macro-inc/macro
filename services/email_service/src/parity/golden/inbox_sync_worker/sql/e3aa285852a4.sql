DELETE FROM email_message_labels WHERE label_id IN ( SELECT id FROM email_labels WHERE link_id = $1 AND provider_label_id = ANY($2) )
