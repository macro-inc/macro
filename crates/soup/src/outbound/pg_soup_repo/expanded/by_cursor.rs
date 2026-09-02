use crate::domain::models::SoupProjectionHydration;
use crate::map_soup_projection_hydration;
use crate::outbound::pg_soup_repo::type_err;
use document_sub_type::DocumentSubType;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{Frecency, Query, SimpleSortMethod};
use models_soup::item::SoupItem;
use sqlx::PgPool;
use std::str::FromStr;
use system_properties::{StatusOption, SystemPropertyKey};
use uuid::Uuid;

/// Returns objects that a user has EXPLICIT and IMPLICIT access to.
///
/// This function returns all items the user can access, including those with inherited
/// permissions through project hierarchy. If a user has access to a project, all items
/// within that project (and its sub-projects) WILL be included in the results, even if
/// the user doesn't have explicit permissions on those items.
/// Sorting is dynamically controlled by the sort_method parameter.
#[tracing::instrument(skip(db, limit))]
async fn expanded_generic_cursor_soup_hydrated(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    limit: u16,
    cursor: Query<Uuid, SimpleSortMethod, ()>,
) -> Result<Vec<SoupProjectionHydration>, sqlx::Error> {
    let query_limit = limit as i64;
    let sort_method_str = cursor.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = cursor.vals();
    let cursor_id = cursor_id.as_ref().map(|u| u.to_string());

    let status_property_id = SystemPropertyKey::STATUS_UUID;
    let assignees_property_id = SystemPropertyKey::ASSIGNEES_UUID;
    let completed_option_id = StatusOption::COMPLETED_UUID.to_string();

    let items: Vec<SoupProjectionHydration> = sqlx::query!(
r#"
        -- =============================================================================
        -- EXPANDED GENERIC CURSOR SOUP QUERY
        -- =============================================================================
        -- Retrieves all items (documents, chats, projects) that a user has access to,
        -- including both explicit permissions and inherited permissions through the
        -- project hierarchy.
        -- =============================================================================

        WITH user_source_ids AS (
            SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
                WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $1
            UNION ALL
            SELECT $1
        ),

        UserAccessibleItems AS (
            SELECT DISTINCT
                ea.entity_id::text as item_id,
                ea.entity_type as item_type
            FROM entity_access ea
            WHERE ea.source_id = ANY(SELECT source_id FROM user_source_ids)
        ),

        -- Identify the top N items with minimal columns before joining full details.
        -- Performs early filtering and sorting to reduce the data processed in
        -- subsequent joins.
        TopItems AS (
            SELECT item_type, id, sort_ts, updated_at FROM (
                SELECT
                    'document'::text as item_type,
                    d.id,
                    -- Dynamic sort column based on user's selected sort method
                    CASE $2
                        WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", d."updatedAt")
                        WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                        WHEN 'created_at' THEN d."createdAt"
                        ELSE d."updatedAt"
                    END::timestamptz as sort_ts,
                    d."updatedAt"::timestamptz as updated_at
                FROM "Document" d
                INNER JOIN UserAccessibleItems uai ON uai.item_id = d.id AND uai.item_type = 'document'
                LEFT JOIN "UserHistory" uh ON uh."itemId" = d.id AND uh."itemType" = 'document' AND uh."userId" = $1
                WHERE d."deletedAt" IS NULL

                UNION ALL

                SELECT
                    'chat'::text,
                    c.id,
                    CASE $2
                        WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", c."updatedAt")
                        WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                        WHEN 'created_at' THEN c."createdAt"
                        ELSE c."updatedAt"
                    END::timestamptz,
                    c."updatedAt"::timestamptz
                FROM "Chat" c
                INNER JOIN UserAccessibleItems uai ON uai.item_id = c.id AND uai.item_type = 'chat'
                LEFT JOIN "UserHistory" uh ON uh."itemId" = c.id AND uh."itemType" = 'chat' AND uh."userId" = $1
                WHERE c."deletedAt" IS NULL

                UNION ALL

                SELECT
                    'project'::text,
                    p.id,
                    CASE $2
                        WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", p."updatedAt")
                        WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                        WHEN 'created_at' THEN p."createdAt"
                        ELSE p."updatedAt"
                    END::timestamptz,
                    p."updatedAt"::timestamptz
                FROM "Project" p
                INNER JOIN UserAccessibleItems uai ON uai.item_id = p.id AND uai.item_type = 'project'
                LEFT JOIN "UserHistory" uh ON uh."itemId" = p.id AND uh."itemType" = 'project' AND uh."userId" = $1
                WHERE p."deletedAt" IS NULL
            ) all_items
            WHERE
                -- Cursor-based pagination: skip items we've already seen.
                -- NULL cursor means first page (no items to skip).
                ($4::timestamptz IS NULL)
                OR
                -- Seek method: find items "before" the cursor position
                -- using (sort_ts, id) tuple comparison for deterministic ordering
                (sort_ts, id::text) < ($4, $5)
            ORDER BY sort_ts DESC, id DESC
            LIMIT $3
        )

        -- Join full item details only for the filtered top items.
        SELECT * FROM (
            SELECT
                'document' as "item_type!",
                d.id as "id!",
                CAST(COALESCE(di.id, db.id) as TEXT) as "document_version_id",
                d.owner as "user_id!",
                d.name as "name!",
                d."branchedFromId" as "branched_from_id",
                d."branchedFromVersionId" as "branched_from_version_id",
                d."documentFamilyId" as "document_family_id",
                d."fileType" as "file_type",
                d."createdAt"::timestamptz as "created_at!",
                d."updatedAt"::timestamptz as "updated_at!",
                d."projectId" as "project_id",
                NULL as "is_persistent",
                di.sha as "sha",
                dt.sub_type as "sub_type?: DocumentSubType",
                EXISTS (
                    SELECT 1
                    FROM document_email de
                    WHERE de.document_id = d.id
                ) as "is_email_attachment!",
                (
                    dt.sub_type IS DISTINCT FROM 'task'
                    OR EXISTS (
                        SELECT 1
                        FROM entity_properties ep_assignees
                        WHERE ep_assignees.entity_id = d.id
                            AND ep_assignees.entity_type = 'TASK'
                            AND ep_assignees.property_definition_id = $8
                            AND ep_assignees.values->'value' @> jsonb_build_array(
                                jsonb_build_object('entity_id', $1)
                            )
                    )
                ) as "is_important!",
                ARRAY(
                    SELECT status_option_id::uuid
                    FROM jsonb_array_elements_text(
                        CASE
                            WHEN jsonb_typeof(ep_status.values->'value') = 'array'
                            THEN ep_status.values->'value'
                            ELSE '[]'::jsonb
                        END
                    ) AS status_option_id
                ) as "status_option_ids!: Vec<Uuid>",
                uh."updatedAt"::timestamptz as "viewed_at",
                t.sort_ts as "sort_ts!",
                -- Task completion status: check if status property matches "completed"
                CASE
                    WHEN dt.sub_type = 'task'
                        AND ep_status.values->'value' ? $6
                    THEN true
                    WHEN dt.sub_type = 'task'
                    THEN false
                    ELSE NULL
                END as "is_completed",
                d."deletedAt"::timestamptz as "deleted_at"
            FROM TopItems t
            INNER JOIN "Document" d ON d.id = t.id
            LEFT JOIN document_sub_type dt ON dt.document_id = d.id
            LEFT JOIN entity_properties ep_status
                ON dt.sub_type = 'task'
                AND ep_status.entity_id = d.id
                AND ep_status.entity_type = 'TASK'
                AND ep_status.property_definition_id = $7
            LEFT JOIN "UserHistory" uh
                ON uh."itemId" = d.id AND uh."itemType" = 'document' AND uh."userId" = $1
            -- LATERAL joins to get the latest version info
            LEFT JOIN LATERAL (
                SELECT b.id
                FROM "DocumentBom" b
                WHERE b."documentId" = d.id
                ORDER BY b."createdAt" DESC
                LIMIT 1
            ) db ON true
            LEFT JOIN LATERAL (
                SELECT i.id, i.sha
                FROM "DocumentInstance" i
                WHERE i."documentId" = d.id
                ORDER BY i."updatedAt" DESC
                LIMIT 1
            ) di ON true
            WHERE t.item_type = 'document'

            UNION ALL

            SELECT
                'chat' as "item_type!",
                c.id as "id!",
                NULL as "document_version_id",
                c."userId" as "user_id!",
                c.name as "name!",
                NULL as "branched_from_id",
                NULL as "branched_from_version_id",
                NULL as "document_family_id",
                NULL as "file_type",
                c."createdAt"::timestamptz as "created_at!",
                c."updatedAt"::timestamptz as "updated_at!",
                c."projectId" as "project_id",
                c."isPersistent" as "is_persistent",
                NULL as "sha",
                NULL as "sub_type",
                false as "is_email_attachment!",
                true as "is_important!",
                ARRAY[]::uuid[] as "status_option_ids!: Vec<Uuid>",
                uh."updatedAt"::timestamptz as "viewed_at",
                t.sort_ts as "sort_ts!",
                NULL as "is_completed",
                c."deletedAt"::timestamptz as "deleted_at"
            FROM TopItems t
            INNER JOIN "Chat" c ON c.id = t.id
            LEFT JOIN "UserHistory" uh
                ON uh."itemId" = c.id AND uh."itemType" = 'chat' AND uh."userId" = $1
            WHERE t.item_type = 'chat'

            UNION ALL

            SELECT
                'project' as "item_type!",
                p.id as "id!",
                NULL as "document_version_id",
                p."userId" as "user_id!",
                p.name as "name!",
                NULL as "branched_from_id",
                NULL as "branched_from_version_id",
                NULL as "document_family_id",
                NULL as "file_type",
                p."createdAt"::timestamptz as "created_at!",
                p."updatedAt"::timestamptz as "updated_at!",
                p."parentId" as "project_id",
                NULL as "is_persistent",
                NULL as "sha",
                NULL as "sub_type",
                false as "is_email_attachment!",
                true as "is_important!",
                ARRAY[]::uuid[] as "status_option_ids!: Vec<Uuid>",
                uh."updatedAt"::timestamptz as "viewed_at",
                t.sort_ts as "sort_ts!",
                NULL as "is_completed",
                p."deletedAt"::timestamptz as "deleted_at"
            FROM TopItems t
            INNER JOIN "Project" p ON p.id = t.id
            LEFT JOIN "UserHistory" uh
                ON uh."itemId" = p.id AND uh."itemType" = 'project' AND uh."userId" = $1
            WHERE t.item_type = 'project'
        ) Combined
        -- Sort by timestamp descending, with ID as tiebreaker for deterministic pagination.
        -- This ensures consistent ordering when multiple items share the same timestamp,
        -- preventing items from being skipped or duplicated across pages.
        ORDER BY "sort_ts!" DESC, "id!" DESC
        LIMIT $3
"#,
        user_id.as_ref(),    // $1
        sort_method_str,     // $2
        query_limit,         // $3
        cursor_timestamp,    // $4
        cursor_id,           // $5
        completed_option_id, // $6
        status_property_id,  // $7
        assignees_property_id, // $8
    )
        .try_map(map_soup_projection_hydration!())
        .fetch_all(db)
        .await?;

    Ok(items)
}

/// Returns expanded objects with projection metadata loaded from the same
/// authorized detail rows.
#[tracing::instrument(skip(db, limit))]
pub async fn expanded_generic_cursor_soup_with_projection(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    limit: u16,
    cursor: Query<Uuid, SimpleSortMethod, ()>,
) -> Result<Vec<SoupProjectionHydration>, sqlx::Error> {
    expanded_generic_cursor_soup_hydrated(db, user_id, limit, cursor).await
}

/// Returns expanded objects while discarding internal projection metadata.
#[cfg(test)]
#[tracing::instrument(skip(db, limit))]
pub async fn expanded_generic_cursor_soup(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    limit: u16,
    cursor: Query<Uuid, SimpleSortMethod, ()>,
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    Ok(
        expanded_generic_cursor_soup_hydrated(db, user_id, limit, cursor)
            .await?
            .into_iter()
            .map(|hydration| hydration.item)
            .collect(),
    )
}

/// This is the same query as the expanded generic cursor soup except it will
/// never return items that have frecency scores.
#[tracing::instrument(skip(db, limit))]
async fn no_frecency_expanded_generic_soup_hydrated(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    limit: u16,
    cursor: Query<Uuid, SimpleSortMethod, Frecency>,
) -> Result<Vec<SoupProjectionHydration>, sqlx::Error> {
    let query_limit = limit as i64;
    let sort_method_str = cursor.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = cursor.vals();
    let cursor_id = cursor_id.as_ref().map(|u| u.to_string());

    let status_property_id = SystemPropertyKey::STATUS_UUID;
    let assignees_property_id = SystemPropertyKey::ASSIGNEES_UUID;
    let completed_option_id = StatusOption::COMPLETED_UUID.to_string();

    let items: Vec<SoupProjectionHydration> = sqlx::query!(
r#"        
        WITH user_source_ids AS (
            SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
                WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $1
            UNION ALL
            SELECT $1
        ),
        UserAccessibleItems AS (
            SELECT DISTINCT
                ea.entity_id::text as item_id,
                ea.entity_type as item_type
            FROM entity_access ea
            WHERE ea.source_id = ANY(SELECT source_id FROM user_source_ids)
        ),
        Combined AS (
            SELECT
                'document' as "item_type!",
                d.id as "id!",
                CAST(COALESCE(di.id, db.id) as TEXT) as "document_version_id",
                d.owner as "user_id!",
                d.name as "name!",
                d."branchedFromId" as "branched_from_id",
                d."branchedFromVersionId" as "branched_from_version_id",
                d."documentFamilyId" as "document_family_id",
                d."fileType" as "file_type",
                d."createdAt"::timestamptz as "created_at!",
                d."updatedAt"::timestamptz as "updated_at!",
                d."projectId" as "project_id",
                NULL as "is_persistent",
                di.sha as "sha",
                dt.sub_type as "sub_type?: DocumentSubType",
                EXISTS (
                    SELECT 1
                    FROM document_email de
                    WHERE de.document_id = d.id
                ) as "is_email_attachment!",
                (
                    dt.sub_type IS DISTINCT FROM 'task'
                    OR EXISTS (
                        SELECT 1
                        FROM entity_properties ep_assignees
                        WHERE ep_assignees.entity_id = d.id
                            AND ep_assignees.entity_type = 'TASK'
                            AND ep_assignees.property_definition_id = $8
                            AND ep_assignees.values->'value' @> jsonb_build_array(
                                jsonb_build_object('entity_id', $1)
                            )
                    )
                ) as "is_important!",
                ARRAY(
                    SELECT status_option_id::uuid
                    FROM jsonb_array_elements_text(
                        CASE
                            WHEN jsonb_typeof(ep_status.values->'value') = 'array'
                            THEN ep_status.values->'value'
                            ELSE '[]'::jsonb
                        END
                    ) AS status_option_id
                ) as "status_option_ids!: Vec<Uuid>",
                uh."updatedAt"::timestamptz as "viewed_at",
                CASE $2
                    WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", d."updatedAt")
                    WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                    WHEN 'created_at' THEN d."createdAt"
                    ELSE d."updatedAt"
                END::timestamptz as "sort_ts!",
                CASE
                    WHEN dt.sub_type = 'task'
                        AND ep_status.values->'value' ? $6
                    THEN true
                    WHEN dt.sub_type = 'task'
                    THEN false
                    ELSE NULL
                END as "is_completed",
                d."deletedAt"::timestamptz as "deleted_at"
            FROM "Document" d
            LEFT JOIN document_sub_type dt ON dt.document_id = d.id
            LEFT JOIN entity_properties ep_status
                ON dt.sub_type = 'task'
                AND ep_status.entity_id = d.id
                AND ep_status.entity_type = 'TASK'
                AND ep_status.property_definition_id = $7
            INNER JOIN UserAccessibleItems uai ON uai.item_id = d.id AND uai.item_type = 'document'
            -- This MUST be a LEFT JOIN to support all three sort methods
            LEFT JOIN "UserHistory" uh ON uh."itemId" = d.id AND uh."itemType" = 'document' AND uh."userId" = $1
            LEFT JOIN LATERAL (
                SELECT b.id
                FROM "DocumentBom" b
                WHERE b."documentId" = d.id
                ORDER BY b."createdAt" DESC
                LIMIT 1
            ) db ON true
            LEFT JOIN LATERAL (
                SELECT i.id, i.sha
                FROM "DocumentInstance" i
                WHERE i."documentId" = d.id
                ORDER BY i."updatedAt" DESC
                LIMIT 1
            ) di ON true
            WHERE d."deletedAt" IS NULL

            UNION ALL

            SELECT
                'chat' as "item_type!",
                c.id as "id!",
                NULL as "document_version_id",
                c."userId" as "user_id!",
                c.name as "name!",
                NULL as "branched_from_id",
                NULL as "branched_from_version_id",
                NULL as "document_family_id",
                NULL as "file_type",
                c."createdAt"::timestamptz as "created_at!",
                c."updatedAt"::timestamptz as "updated_at!",
                c."projectId" as "project_id",
                c."isPersistent" as "is_persistent",
                NULL as "sha",
                NULL as "sub_type",
                false as "is_email_attachment!",
                true as "is_important!",
                ARRAY[]::uuid[] as "status_option_ids!: Vec<Uuid>",
                uh."updatedAt"::timestamptz as "viewed_at",
                CASE $2
                    WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", c."updatedAt")
                    WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                    WHEN 'created_at' THEN c."createdAt"
                    ELSE c."updatedAt"
                END::timestamptz as "sort_ts!",
                NULL as "is_completed",
                c."deletedAt"::timestamptz as "deleted_at"
            FROM "Chat" c
            INNER JOIN UserAccessibleItems uai ON uai.item_id = c.id AND uai.item_type = 'chat'
            LEFT JOIN "UserHistory" uh ON uh."itemId" = c.id AND uh."itemType" = 'chat' AND uh."userId" = $1
            WHERE c."deletedAt" IS NULL

            UNION ALL

            SELECT
                'project' as "item_type!",
                p.id as "id!",
                NULL as "document_version_id",
                p."userId" as "user_id!",
                p.name as "name!",
                NULL as "branched_from_id",
                NULL as "branched_from_version_id",
                NULL as "document_family_id",
                NULL as "file_type",
                p."createdAt"::timestamptz as "created_at!",
                p."updatedAt"::timestamptz as "updated_at!",
                p."parentId" as "project_id",
                NULL as "is_persistent",
                NULL as "sha",
                NULL as "sub_type",
                false as "is_email_attachment!",
                true as "is_important!",
                ARRAY[]::uuid[] as "status_option_ids!: Vec<Uuid>",
                uh."updatedAt"::timestamptz as "viewed_at",
                CASE $2
                    WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", p."updatedAt")
                    WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                    WHEN 'created_at'  THEN p."createdAt"
                    ELSE p."updatedAt"
                END::timestamptz as "sort_ts!",
                NULL as "is_completed",
                p."deletedAt"::timestamptz as "deleted_at"
            FROM "Project" p
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = p.id
                AND uai.item_type = 'project'
            LEFT JOIN "UserHistory" uh
                ON uh."itemId" = p.id
                AND uh."itemType" = 'project'
                AND uh."userId" = $1
            WHERE p."deletedAt" IS NULL
        )
      SELECT Combined.* FROM Combined
      LEFT JOIN frecency_aggregates fa
          ON fa.entity_id = Combined."id!"
          AND fa.entity_type = Combined."item_type!"
          AND fa.user_id = $1
      WHERE fa.id IS NULL
          AND (
              ($4::timestamptz IS NULL)
              OR
              (Combined."sort_ts!", Combined."id!"::text) < ($4, $5)
          )
      ORDER BY Combined."sort_ts!" DESC, Combined."id!" DESC
      LIMIT $3
  "#,
        user_id.as_ref(),    // $1
        sort_method_str,     // $2
        query_limit,         // $3
        cursor_timestamp,    // $4
        cursor_id,           // $5
        completed_option_id, // $6
        status_property_id,  // $7
        assignees_property_id, // $8
    )
        .try_map(map_soup_projection_hydration!())
        .fetch_all(db)
        .await?;

    Ok(items)
}

/// Returns the non-frecency expanded fallback with projection metadata.
#[tracing::instrument(skip(db, limit))]
pub async fn no_frecency_expanded_generic_soup_with_projection(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    limit: u16,
    cursor: Query<Uuid, SimpleSortMethod, Frecency>,
) -> Result<Vec<SoupProjectionHydration>, sqlx::Error> {
    no_frecency_expanded_generic_soup_hydrated(db, user_id, limit, cursor).await
}

/// Returns the non-frecency expanded fallback without projection metadata.
#[tracing::instrument(skip(db, limit))]
pub async fn no_frecency_expanded_generic_soup(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    limit: u16,
    cursor: Query<Uuid, SimpleSortMethod, Frecency>,
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    Ok(
        no_frecency_expanded_generic_soup_hydrated(db, user_id, limit, cursor)
            .await?
            .into_iter()
            .map(|hydration| hydration.item)
            .collect(),
    )
}
