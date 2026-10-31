        SELECT i.id, i.name, i.owner_user_id, i.created_at, i.updated_at, uh."updatedAt"::timestamptz AS viewed_at
        FROM initiative i
        LEFT JOIN "UserHistory" uh ON uh."itemId" = i.id::text
            AND uh."itemType" = 'initiative' AND uh."userId" = $1
        WHERE i.id = ANY($2)
