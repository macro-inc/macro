SELECT gh.history_id FROM email_links l LEFT JOIN email_gmail_histories gh ON l.id = gh.link_id WHERE l.email_address = $1 AND l.provider = $2
