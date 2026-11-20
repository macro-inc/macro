-- One page of legacy edges in id order with the evidence the audit reads from
-- the database for each direction. Each probe is an index lookup on one user,
-- team or inbox, so a page costs a few lookups per edge.
WITH edges AS MATERIALIZED (
    SELECT id, user1, user2
    FROM contacts_connections
    WHERE id > $1
    ORDER BY id
    LIMIT $2
)
SELECT
    e.id,
    e.user1,
    e.user2,
    EXISTS (
        SELECT 1
        FROM team_user t1
        JOIN team_user t2 ON t2.team_id = t1.team_id
        WHERE t1.user_id = e.user1 AND t2.user_id = e.user2
    ) AS "teammates!",
    EXISTS (
        SELECT 1
        FROM email_links l
        JOIN email_contacts ec
          ON ec.link_id = l.id
         AND lower(ec.email_address::text) = lower(substr(e.user2, 7))
        WHERE l.macro_id = e.user1
          AND l.deleting_at IS NULL
          AND l.disconnect_requested_at IS NULL
          AND e.user2 COLLATE "C" LIKE 'macro|%'
    ) AS "user1_inbox_has_user2!",
    EXISTS (
        SELECT 1
        FROM email_links l
        JOIN email_contacts ec
          ON ec.link_id = l.id
         AND lower(ec.email_address::text) = lower(substr(e.user1, 7))
        WHERE l.macro_id = e.user2
          AND l.deleting_at IS NULL
          AND l.disconnect_requested_at IS NULL
          AND e.user1 COLLATE "C" LIKE 'macro|%'
    ) AS "user2_inbox_has_user1!",
    EXISTS (
        SELECT 1
        FROM "User" u
        JOIN email_links_history h ON h.fusionauth_user_id = u.macro_user_id::text
        WHERE u.id = e.user1 AND h.deleted_at IS NOT NULL
    ) AS "user1_disconnected_inbox!",
    EXISTS (
        SELECT 1
        FROM "User" u
        JOIN email_links_history h ON h.fusionauth_user_id = u.macro_user_id::text
        WHERE u.id = e.user2 AND h.deleted_at IS NOT NULL
    ) AS "user2_disconnected_inbox!",
    EXISTS (
        SELECT 1
        FROM "User" u1
        JOIN "User" u2 ON u2.id = e.user2
        JOIN referral_tracking r
          ON (r.referrer_id = u1.macro_user_id AND r.referred_id = u2.macro_user_id)
          OR (r.referrer_id = u2.macro_user_id AND r.referred_id = u1.macro_user_id)
        WHERE u1.id = e.user1
    ) AS "referral!"
FROM edges e
ORDER BY e.id
