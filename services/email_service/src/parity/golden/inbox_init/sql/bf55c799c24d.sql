SELECT email_provider::text AS "email_provider!", macro_user_id, linked_email, requested_google_scopes, granted_google_scopes FROM in_progress_user_link WHERE id = $1
