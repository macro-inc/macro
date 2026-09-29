
        SELECT
            'initiative' as "item_type",
            i.id::text as "id",
            NULL as "document_version_id",
            i.description_document_id as "description_document_id",
            i.description_surface_id::text as "description_surface_id",
            i.owner_user_id as "user_id",
            i.name as "name",
            NULL as "branched_from_id",
            NULL as "branched_from_version_id",
            NULL as "document_family_id",
            NULL as "file_type",
            i.created_at::timestamptz as "created_at",
            i.updated_at::timestamptz as "updated_at",
            NULL::text as "project_id",
            NULL as "is_persistent",
            NULL::text as "model",
            NULL as "sha",
            NULL as "sub_type",
            false as "is_email_attachment",
            true as "is_important",
            ARRAY[]::uuid[] as "status_option_ids",
            uh."updatedAt"::timestamptz as "viewed_at",
            t.sort_ts as "sort_ts",
            NULL as "is_completed",
            NULL::timestamptz as "deleted_at"
        FROM TopItems t
        INNER JOIN initiative i ON i.id::text = t.id
        LEFT JOIN "UserHistory" uh
            ON uh."itemId" = i.id::text
            AND uh."itemType" = 'initiative'
            AND uh."userId" = $1
        WHERE t.item_type = 'initiative'
