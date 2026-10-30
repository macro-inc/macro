SELECT requested.contact AS "contact!"
FROM unnest($2::text[]) WITH ORDINALITY AS requested(contact, ordinal)
-- Keep membership as at most one point-read result per requested ID, rather
-- than a hashed subplan materializing a high-degree viewer's entire directory.
LEFT JOIN LATERAL (
    SELECT TRUE AS present FROM contacts_connections
    WHERE user1 = $1 AND user2 = requested.contact
    UNION ALL
    SELECT TRUE AS present FROM contacts_connections
    WHERE user1 = requested.contact AND user2 = $1
    LIMIT 1
) AS membership ON TRUE
WHERE requested.contact = $1 OR membership.present IS TRUE
ORDER BY requested.ordinal
