SELECT EXISTS(SELECT 1 FROM email_deferred_message_deletions WHERE message_id=$1) AS "deferred!"
