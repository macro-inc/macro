SELECT requested.contact AS "contact!"
FROM unnest($2::text[]) WITH ORDINALITY AS requested(contact, ordinal)
-- Keep membership as at most one point-read result per requested ID, rather
-- than a hashed subplan materializing a high-degree viewer's entire directory.
-- Pages parse supported ASCII case aliases into canonical IDs. Match those
-- aliases through the scoped expression indexes, not a scan of the viewer's
-- neighbors. Preserve raw viewer equality and reject invalid marker casing;
-- C folding must not turn an invalid Unicode identity into an ASCII member.
LEFT JOIN LATERAL (
    SELECT TRUE AS present FROM contacts_connections
    WHERE user1 = $1
      AND lower(user2 COLLATE "C") = requested.contact
      AND user2 COLLATE "C" LIKE 'macro|%'
    UNION ALL
    SELECT TRUE AS present FROM contacts_connections
    WHERE user2 = $1
      AND lower(user1 COLLATE "C") = requested.contact
      AND user1 COLLATE "C" LIKE 'macro|%'
    LIMIT 1
) AS membership ON TRUE
WHERE requested.contact = $1 OR membership.present IS TRUE
ORDER BY requested.ordinal
