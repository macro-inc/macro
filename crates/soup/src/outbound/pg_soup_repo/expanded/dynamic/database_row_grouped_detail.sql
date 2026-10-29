
        SELECT
            'database_row' as "item_type",
            r.id::text as "id",
            NULL::text as "document_version_id",
            row_database.user_id as "user_id",
            NULL::text as "name",
            NULL::text as "branched_from_id",
            NULL::bigint as "branched_from_version_id",
            NULL::bigint as "document_family_id",
            NULL::text as "file_type",
            r.created_at as "created_at",
            r.updated_at as "updated_at",
            NULL::text as "project_id",
            NULL::boolean as "is_persistent",
            NULL::text as "model",
            NULL::text as "sha",
            NULL::document_sub_type_value as "sub_type",
            NULL::timestamptz as "viewed_at",
            gi.sort_ts as "sort_ts",
            NULL::boolean as "is_completed",
            NULL::timestamptz as "deleted_at",
            NULL::jsonb as "calendar_event",
            jsonb_build_object(
                'tableId', r.table_id,
                'databaseId', row_table.database_id,
                'position', r.position,
                'createdBy', r.created_by
            ) as "database_row",
            gi.group_key as "group_key",
            gi.group_total_count as "group_total_count",
            gi.row_in_group as "row_in_group"
        FROM GroupedItems gi
        -- Keep the indexed UUID column bare. Other Soup kinds can have legacy text ids.
        INNER JOIN database_rows r ON r.id = (CASE WHEN gi.item_type = 'database_row' THEN gi.id END)::uuid
        INNER JOIN database_tables row_table ON row_table.id = r.table_id
        INNER JOIN database_entities row_database ON row_database.database_id = row_table.database_id
        WHERE gi.item_type = 'database_row'
