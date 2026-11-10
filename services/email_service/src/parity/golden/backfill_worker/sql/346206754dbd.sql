SELECT l.provider_label_id FROM email_message_labels ml JOIN email_labels l ON l.id = ml.label_id WHERE ml.message_id = $1
