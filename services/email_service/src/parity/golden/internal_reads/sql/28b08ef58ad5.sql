SELECT l.macro_id FROM email_threads t JOIN email_links l ON t.link_id = l.id WHERE t.id = $1
