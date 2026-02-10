use crate::{
    map_soup_type,
    outbound::pg_soup_repo::{populate_properties, type_err},
};
use document_sub_type::DocumentSubType;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_pagination::{Query, SimpleSortMethod};
use models_soup::item::SoupItem;
use sqlx::PgPool;
use std::str::FromStr;
use system_properties::{StatusOption, SystemPropertyKey};
use uuid::Uuid;

/// Returns objects that a user has EXPLICIT access to, including project items.
///
/// This function only returns items that the user has been directly granted permissions for.
/// If a user has access to a project that contains other items, those "child" items will NOT
/// be included in the results unless the user has been explicitly granted permissions on them.
/// This ensures that only directly authorized items are returned, not those with implicit
/// (inherited) access.
#[tracing::instrument(skip(db, limit, cursor))]
pub async fn unexpanded_generic_cursor_soup(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    limit: u16,
    cursor: Query<Uuid, SimpleSortMethod, ()>,
) -> Result<Vec<SoupItem>, sqlx::Error> {
    let query_limit = limit as i64;
    let sort_method_str = cursor.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = cursor.vals();
    let cursor_id = cursor_id.map(|u| u.to_string());

    let status_property_id = SystemPropertyKey::STATUS_UUID;
    let completed_option_id = StatusOption::COMPLETED_UUID.to_string();

    let mut items: Vec<SoupItem> = sqlx::query!(
        r#"
        WITH UserAccessibleItems AS (
            SELECT DISTINCT ON ("item_id", "item_type")
                "item_id",
                "item_type"
            FROM "UserItemAccess" 
            WHERE "user_id" = $1
            ORDER BY "item_id", "item_type", 
                CASE "access_level"
                    WHEN 'owner' THEN 4
                    WHEN 'edit' THEN 3 
                    WHEN 'comment' THEN 2
                    WHEN 'view' THEN 1
                    ELSE 0
                END DESC
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
                uh."updatedAt"::timestamptz as "viewed_at",
                CASE $2
                    WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", d."updatedAt")
                    WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                    WHEN 'created_at'  THEN d."createdAt"
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
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = d.id
                AND uai.item_type = 'document'
            LEFT JOIN "UserHistory" uh
                ON uh."itemId" = d.id
                AND uh."itemType" = 'document'
                AND uh."userId" = $1
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
                uh."updatedAt"::timestamptz as "viewed_at",
                CASE $2
                    WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", c."updatedAt")
                    WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                    WHEN 'created_at'  THEN c."createdAt"
                    ELSE c."updatedAt"
                END::timestamptz as "sort_ts!",
                NULL as "is_completed",
                c."deletedAt"::timestamptz as "deleted_at"
            FROM "Chat" c
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = c.id
                AND uai.item_type = 'chat'
            LEFT JOIN "UserHistory" uh
                ON uh."itemId" = c.id
                AND uh."itemType" = 'chat'
                AND uh."userId" = $1
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
        SELECT * 
        FROM Combined
        WHERE ($4::timestamptz IS NULL)
            OR ("sort_ts!", "id!") < ($4, $5)
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
    )
    .try_map(map_soup_type!())
    .fetch_all(db)
    .await?;

    populate_properties(db, &mut items).await?;

    Ok(items)
}
