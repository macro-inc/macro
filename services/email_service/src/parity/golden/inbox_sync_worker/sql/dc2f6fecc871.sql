SELECT EXISTS(SELECT 1 FROM email_messages WHERE thread_id = $1) AS "exists!"
