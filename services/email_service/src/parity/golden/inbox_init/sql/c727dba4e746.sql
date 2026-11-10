SELECT COALESCE(g.grant_version, 0) = 0 AS "unrecorded!" FROM email_links l LEFT JOIN email_link_google_scopes g ON g.link_id = l.id WHERE l.id = $1
