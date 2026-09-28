
        SELECT
            'initiative' as "item_type",
            i.id::text as "id",
            NULL::text as "document_version_id",
            i.description_document_id as "description_document_id",
            i.owner_user_id as "user_id",
            i.name as "name",
            NULL::text as "branched_from_id",
            NULL::bigint as "branched_from_version_id",
            NULL::bigint as "document_family_id",
            NULL::text as "file_type",
            i.created_at::timestamptz as "created_at",
            i.updated_at::timestamptz as "updated_at",
            NULL::text as "project_id",
            NULL::boolean as "is_persistent",
            NULL::text as "model",
            NULL::text as "sha",
            NULL::document_sub_type_value as "sub_type",
            uh."updatedAt"::timestamptz as "viewed_at",
            gi.sort_ts as "sort_ts",
            NULL::boolean as "is_completed",
            NULL::timestamptz as "deleted_at",
            NULL::jsonb as "calendar_event",
            gi.group_key as "group_key",
            gi.group_total_count as "group_total_count",
            gi.row_in_group as "row_in_group"
        FROM GroupedItems gi
        INNER JOIN initiative i ON i.id::text = gi.id
        LEFT JOIN "UserHistory" uh
            ON uh."itemId" = i.id::text
            AND uh."itemType" = 'initiative'
            AND uh."userId" = $1
        WHERE gi.item_type = 'initiative'
