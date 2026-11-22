-- The requested ids that are in the viewer's legacy directory, in request
-- order: self, a current teammate, someone the viewer's own inbox or invite
-- names, or the other end of one of the viewer's edges. $1 viewer, $2 canonical requested ids.
--
-- Team joins no longer write edges, so teammates come from team_user, ids
-- folded like the list-aware lookup; the roster is read once.
WITH teammates AS MATERIALIZED (
    SELECT lower(teammate.user_id COLLATE "C") AS id
    FROM team_user AS own
    JOIN team_user AS teammate ON teammate.team_id = own.team_id
    WHERE own.user_id IN (
        -- team_user may hold a legacy mixed-case id for this user. Find
        -- it through the lower(email) index and keep it only if it folds
        -- to the canonical id.
        SELECT $1::text
        UNION
        SELECT account.id
        FROM "User" AS account
        WHERE lower(account.email) = substr($1, length('macro|') + 1)
          AND lower(account.id COLLATE "C") = $1
    )
)
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
WHERE requested.contact = $1
   OR requested.contact COLLATE "C" IN (SELECT id FROM teammates)
   -- The viewer's own inbox or invited row, so a contact the viewer really
   -- has stays listed after a team removal deletes its edge.
   OR EXISTS (
       SELECT 1 FROM contact_inbox_members AS mine
       WHERE mine.user_id = lower($1 COLLATE "C")
         AND mine.contact_user_id = requested.contact
   )
   OR EXISTS (
       SELECT 1 FROM contact_list_members AS mine
       WHERE mine.user_id = lower($1 COLLATE "C")
         AND mine.contact_user_id = requested.contact
         AND mine.list_key = 'invited'
   )
   -- An edge counts unless only the peer has the viewer, as in page.sql: the
   -- peer's inbox or invite names the viewer, and no list or inbox row of
   -- the viewer's names the peer. Ids in the lists are canonical, like
   -- requested.contact.
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
       )
   )
ORDER BY requested.ordinal
