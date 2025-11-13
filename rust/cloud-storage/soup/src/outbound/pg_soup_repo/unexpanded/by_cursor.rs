use item_filters::ast::EntityFilterAst;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{Query, SimpleSortMethod};
use models_soup::{
    chat::map_soup_chat, document::map_soup_document, item::SoupItem, project::map_soup_project,
};
use sqlx::PgPool;

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
    cursor: Query<String, SimpleSortMethod, EntityFilterAst>,
) -> Result<Vec<SoupItem>, sqlx::Error> {
    let query_limit = limit as i64;
    let sort_method_str = cursor.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = cursor.vals();

    let items: Vec<SoupItem> = sqlx::query!(
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
                uh."updatedAt"::timestamptz as "viewed_at",
                CASE $2
                    WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", d."updatedAt")
                    WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                    WHEN 'created_at'  THEN d."createdAt"
                    ELSE d."updatedAt"
                END::timestamptz as "sort_ts!"
            FROM "Document" d
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
            LEFT JOIN "DocumentEmail" de ON de.document_id = d.id
            WHERE d."deletedAt" IS NULL
                AND de.document_id IS NULL -- don't include email attachments in soup for now

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
                uh."updatedAt"::timestamptz as "viewed_at",
                CASE $2
                    WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", c."updatedAt")
                    WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                    WHEN 'created_at'  THEN c."createdAt"
                    ELSE c."updatedAt"
                END::timestamptz as "sort_ts!"
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
                uh."updatedAt"::timestamptz as "viewed_at",
                CASE $2
                    WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", p."updatedAt")
                    WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                    WHEN 'created_at'  THEN p."createdAt"
                    ELSE p."updatedAt"
                END::timestamptz as "sort_ts!"
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
        ORDER BY "sort_ts!" DESC, "updated_at!" DESC
        LIMIT $3
        "#,
        user_id.as_ref(), // $1
        sort_method_str,  // $2
        query_limit,      // $3
        cursor_timestamp, // $4
        cursor_id,        // $5
    )
    .try_map(|r| match r.item_type.as_ref() {
        "document" => {
            let document = map_soup_document(
                r.id,
                r.user_id,
                r.document_version_id,
                r.name,
                r.sha,
                r.file_type,
                r.document_family_id,
                r.branched_from_id,
                r.branched_from_version_id,
                r.project_id,
                r.created_at,
                r.updated_at,
                r.viewed_at,
            )
            .map_err(|e| sqlx::Error::TypeNotFound {
                type_name: e.to_string(),
            })?;
            Ok(SoupItem::Document(document))
        }
        "chat" => Ok(SoupItem::Chat(map_soup_chat(
            r.id,
            r.user_id,
            r.name,
            r.project_id,
            r.is_persistent,
            r.created_at,
            r.updated_at,
            r.viewed_at,
        ))),
        "project" => Ok(SoupItem::Project(map_soup_project(
            r.id,
            r.user_id,
            r.name,
            r.project_id,
            r.created_at,
            r.updated_at,
            r.viewed_at,
        ))),
        _ => Err(sqlx::Error::TypeNotFound {
            type_name: r.item_type,
        }),
    })
    .fetch_all(db)
    .await?;

    Ok(items)
}

/// Returns objects that a user has EXPLICIT access to, including project items.
///
/// This function only returns items that the user has been directly granted permissions for.
/// If a user has access to a project that contains other items, those "child" items will NOT
/// be included in the results unless the user has been explicitly granted permissions on them.
/// This ensures that only directly authorized items are returned, not those with implicit
/// (inherited) access.
#[tracing::instrument(skip(db, limit, cursor))]
pub async fn no_frecency_unexpanded_generic_cursor_soup(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    limit: u16,
    cursor: Query<String, SimpleSortMethod, ()>,
) -> Result<Vec<SoupItem>, sqlx::Error> {
    let query_limit = limit as i64;
    let sort_method_str = cursor.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = cursor.vals();

    let items: Vec<SoupItem> = sqlx::query!(
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
                uh."updatedAt"::timestamptz as "viewed_at",
                CASE $2
                    WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", d."updatedAt")
                    WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                    WHEN 'created_at'  THEN d."createdAt"
                    ELSE d."updatedAt"
                END::timestamptz as "sort_ts!"
            FROM "Document" d
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
            LEFT JOIN "DocumentEmail" de ON de.document_id = d.id
            WHERE d."deletedAt" IS NULL
                AND de.document_id IS NULL -- don't include email attachments in soup for now

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
                uh."updatedAt"::timestamptz as "viewed_at",
                CASE $2
                    WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", c."updatedAt")
                    WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                    WHEN 'created_at'  THEN c."createdAt"
                    ELSE c."updatedAt"
                END::timestamptz as "sort_ts!"
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
                uh."updatedAt"::timestamptz as "viewed_at",
                CASE $2
                    WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", p."updatedAt")
                    WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                    WHEN 'created_at'  THEN p."createdAt"
                    ELSE p."updatedAt"
                END::timestamptz as "sort_ts!"
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
              (Combined."sort_ts!", Combined."id!") < ($4, $5)
          )
      ORDER BY Combined."sort_ts!" DESC, Combined."updated_at!" DESC
      LIMIT $3
          "#,
        user_id.as_ref(), // $1
        sort_method_str,  // $2
        query_limit,      // $3
        cursor_timestamp, // $4
        cursor_id,        // $5
    )
    .try_map(|r| match r.item_type.as_ref() {
        "document" => {
            let document = map_soup_document(
                r.id,
                r.user_id,
                r.document_version_id,
                r.name,
                r.sha,
                r.file_type,
                r.document_family_id,
                r.branched_from_id,
                r.branched_from_version_id,
                r.project_id,
                r.created_at,
                r.updated_at,
                r.viewed_at,
            )
            .map_err(|e| sqlx::Error::TypeNotFound {
                type_name: e.to_string(),
            })?;
            Ok(SoupItem::Document(document))
        }
        "chat" => Ok(SoupItem::Chat(map_soup_chat(
            r.id,
            r.user_id,
            r.name,
            r.project_id,
            r.is_persistent,
            r.created_at,
            r.updated_at,
            r.viewed_at,
        ))),
        "project" => Ok(SoupItem::Project(map_soup_project(
            r.id,
            r.user_id,
            r.name,
            r.project_id,
            r.created_at,
            r.updated_at,
            r.viewed_at,
        ))),
        _ => Err(sqlx::Error::TypeNotFound {
            type_name: r.item_type,
        }),
    })
    .fetch_all(db)
    .await?;

    Ok(items)
}
