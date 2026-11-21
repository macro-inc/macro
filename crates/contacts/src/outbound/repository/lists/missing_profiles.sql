-- The ids, of at most the 510 a message names, that have no profile. A
-- profile matches by id or, for a legacy "User" id stored with capitals, by
-- its address (User_lower_email_idx). At most two index probes each; OFFSET 0
-- keeps each check a per-id probe, never a hash of the whole "User" table
-- when its statistics are stale.
SELECT input.id AS "id!"
FROM unnest($1::text[]) AS input (id)
WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE "User".id = input.id OFFSET 0)
  AND NOT EXISTS (
      SELECT 1 FROM "User" WHERE lower("User".email) = substr(input.id, 7) OFFSET 0
  )
