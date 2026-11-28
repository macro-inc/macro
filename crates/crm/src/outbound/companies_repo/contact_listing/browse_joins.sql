    LEFT JOIN crm_domain_directory dd ON dd.domain = LOWER(primary_domain.domain)
    LEFT JOIN "UserHistory" uh
        ON uh."itemId" = ct.id::text AND uh."itemType" = 'crm_contact'
       AND uh."userId" =
