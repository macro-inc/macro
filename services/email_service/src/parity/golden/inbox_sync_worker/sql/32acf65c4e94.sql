SELECT l.provider='OUTLOOK' AS "stable!" FROM email_messages m JOIN email_links l ON l.id=m.link_id WHERE m.id=$1
