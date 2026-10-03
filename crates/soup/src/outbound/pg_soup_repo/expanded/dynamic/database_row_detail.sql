
        SELECT
            'database_row' as "item_type",
            r.id::text as "id",
            NULL as "document_version_id",
            NULL::text as "description_document_id",
            row_database.owner_id as "user_id",
            NULL::text as "name",
            NULL as "branched_from_id",
            NULL as "branched_from_version_id",
            NULL as "document_family_id",
            NULL as "file_type",
            r.created_at as "created_at",
            r.updated_at as "updated_at",
            NULL::text as "project_id",
            NULL as "is_persistent",
            NULL::text as "model",
            NULL as "sha",
            NULL as "sub_type",
            false as "is_email_attachment",
            true as "is_important",
            ARRAY[]::uuid[] as "status_option_ids",
            NULL::timestamptz as "viewed_at",
            t.sort_ts as "sort_ts",
            NULL as "is_completed",
            NULL::timestamptz as "deleted_at",
            jsonb_build_object(
                'tableId', r.table_id,
                'databaseId', row_table.database_id,
                'position', r.position,
                'createdBy', r.created_by
            ) as "database_row"
        FROM TopItems t
        INNER JOIN database_rows r ON r.id::text = t.id
        INNER JOIN database_tables row_table ON row_table.id = r.table_id
        INNER JOIN databases row_database ON row_database.id = row_table.database_id
        WHERE t.item_type = 'database_row'
