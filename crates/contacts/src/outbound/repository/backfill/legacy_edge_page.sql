-- One page of legacy edges in id order with the evidence the audit reads from
-- the database for each direction. Each probe is an index lookup on one user,
-- team or inbox, so a page costs a few lookups per edge. The probes are scalar
-- subqueries, not EXISTS: a generic plan may run an uncorrelated-looking
-- EXISTS once as a hashed subplan over every user.
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
    COALESCE((
        SELECT true
        FROM team_user t1
        JOIN team_user t2 ON t2.team_id = t1.team_id
        WHERE t1.user_id = COALESCE(account1.id, e.user1)
          AND t2.user_id = COALESCE(account2.id, e.user2)
        LIMIT 1
    ), false) AS "teammates!",
    -- A referral invite already put the contact in the owner's invited
    -- list, which keeps them whatever else explains the edge.
    COALESCE((
        SELECT true
        FROM contact_list_members m
        WHERE m.user_id = lower(e.user1) COLLATE "C"
          AND m.contact_user_id = lower(e.user2) COLLATE "C"
          AND m.list_key = $3
        LIMIT 1
    ), false) AS "user1_invited_user2!",
    COALESCE((
        SELECT true
        FROM contact_list_members m
        WHERE m.user_id = lower(e.user2) COLLATE "C"
          AND m.contact_user_id = lower(e.user1) COLLATE "C"
          AND m.list_key = $3
        LIMIT 1
    ), false) AS "user2_invited_user1!",
    COALESCE((
        SELECT true
        FROM email_links l
        JOIN email_contacts ec
          ON ec.link_id = l.id
         AND lower(ec.email_address::text) = lower(substr(e.user2, 7))
        WHERE l.macro_id = e.user1
          AND l.deleting_at IS NULL
          AND l.disconnect_requested_at IS NULL
          AND e.user2 COLLATE "C" LIKE 'macro|%'
        LIMIT 1
    ), false) AS "user1_inbox_has_user2!",
    COALESCE((
        SELECT true
        FROM email_links l
        JOIN email_contacts ec
          ON ec.link_id = l.id
         AND lower(ec.email_address::text) = lower(substr(e.user1, 7))
        WHERE l.macro_id = e.user2
          AND l.deleting_at IS NULL
          AND l.disconnect_requested_at IS NULL
          AND e.user1 COLLATE "C" LIKE 'macro|%'
        LIMIT 1
    ), false) AS "user2_inbox_has_user1!",
    COALESCE((
        SELECT true
        FROM email_links_history h
        WHERE h.fusionauth_user_id = account1.macro_user_id::text
          AND h.deleted_at IS NOT NULL
        LIMIT 1
    ), false) AS "user1_disconnected_inbox!",
    COALESCE((
        SELECT true
        FROM email_links_history h
        WHERE h.fusionauth_user_id = account2.macro_user_id::text
          AND h.deleted_at IS NOT NULL
        LIMIT 1
    ), false) AS "user2_disconnected_inbox!",
    COALESCE((
        SELECT true
        FROM referral_tracking r
        WHERE (r.referrer_id = account1.macro_user_id AND r.referred_id = account2.macro_user_id)
           OR (r.referrer_id = account2.macro_user_id AND r.referred_id = account1.macro_user_id)
        LIMIT 1
    ), false) AS "referral!"
FROM edges e
-- Each end's account, by id or, for an id stored in another case, by
-- address (User_id_key, User_lower_email_idx).
LEFT JOIN LATERAL (
    SELECT u.id, u.macro_user_id
    FROM "User" u
    WHERE u.id = e.user1 OR lower(u.email) = lower(substr(e.user1, 7))
    ORDER BY u.id = e.user1 DESC
    LIMIT 1
) AS account1 ON true
LEFT JOIN LATERAL (
    SELECT u.id, u.macro_user_id
    FROM "User" u
    WHERE u.id = e.user2 OR lower(u.email) = lower(substr(e.user2, 7))
    ORDER BY u.id = e.user2 DESC
    LIMIT 1
) AS account2 ON true
ORDER BY e.id
