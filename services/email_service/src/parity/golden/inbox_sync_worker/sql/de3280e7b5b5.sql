DELETE FROM email_labels WHERE link_id = $1 AND provider_label_id = ANY($2)
