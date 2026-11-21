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
-- Hide a peer only the peer has, as page.sql does: the peer's inbox or invite
-- names the viewer, and no list or inbox row of the viewer's, nor the team,
-- names the peer. Ids in the lists are canonical, like requested.contact.
WHERE requested.contact = $1
   OR (
       membership.present IS TRUE
       AND NOT (
           (
               EXISTS (
                   SELECT 1 FROM contact_inbox_members AS theirs
                   WHERE theirs.user_id = requested.contact
                     AND theirs.contact_user_id = lower($1 COLLATE "C")
               )
               OR EXISTS (
                   SELECT 1 FROM contact_list_members AS theirs
                   WHERE theirs.user_id = requested.contact
                     AND theirs.contact_user_id = lower($1 COLLATE "C")
                     AND theirs.list_key = 'invited'
               )
           )
           AND NOT EXISTS (
               SELECT 1 FROM contact_list_members AS mine
               WHERE mine.user_id = lower($1 COLLATE "C")
                 AND mine.contact_user_id = requested.contact
           )
           AND NOT EXISTS (
               SELECT 1 FROM contact_inbox_members AS mine
               WHERE mine.user_id = lower($1 COLLATE "C")
                 AND mine.contact_user_id = requested.contact
           )
           AND NOT EXISTS (
               SELECT 1
               FROM team_user AS own
               JOIN team_user AS teammate ON teammate.team_id = own.team_id
               WHERE own.user_id = $1
                 AND lower(teammate.user_id COLLATE "C") = requested.contact
           )
       )
   )
ORDER BY requested.ordinal
