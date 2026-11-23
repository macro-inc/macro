-- Removes the deleted user's own rows (primary-key prefix) and every row
-- naming them (the contact indexes), and returns the other owners who lost
-- them. Each data-modifying CTE runs whether or not the outer query reads it.
WITH owned_lists AS (
    DELETE FROM contact_list_members WHERE user_id = $1
), owned_inbox AS (
    DELETE FROM contact_inbox_members WHERE user_id = $1
), listed AS (
    DELETE FROM contact_list_members WHERE contact_user_id = $1
    RETURNING user_id
), inboxed AS (
    DELETE FROM contact_inbox_members WHERE contact_user_id = $1
    RETURNING user_id
)
SELECT user_id AS "user_id!" FROM listed
UNION
SELECT user_id FROM inboxed
