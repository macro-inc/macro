    LEFT JOIN LATERAL (
        SELECT dd.name
        FROM crm_domain_directory dd
        -- Seek through the directory's unique index while preserving the
        -- same stored-domain match as the browsing query.
        WHERE LOWER(dd.domain) = LOWER(primary_domain.domain)
          AND dd.domain = LOWER(primary_domain.domain)
        LIMIT 1
    ) dd ON TRUE
    LEFT JOIN LATERAL (
        SELECT "userId", "itemId", "itemType", "updatedAt"
        FROM "UserHistory"
        WHERE ("userId", "itemId", "itemType") >= (
