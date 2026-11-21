-- The ids, of at most the 510 a message names, that have no profile. One
-- primary-key probe each.
SELECT input.id AS "id!"
FROM unnest($1::text[]) AS input (id)
WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE "User".id = input.id)
