use std::str::FromStr;

use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::{Entity, EntityType};
use models_soup::{chat::SoupChat, document::SoupDocument, item::SoupItem};
use sqlx::PgPool;
use uuid::Uuid;

use crate::outbound::pg_soup_repo::type_err;

/// Returns objects that a user has EXPLICIT and IMPLICIT access to by their IDs, excluding project items.
///
/// This function returns all requested items the user can access, including those with inherited
/// permissions through project hierarchy. If a user has access to a project that contains
/// the requested items, those items WILL be included in the results even if the user doesn't
/// have explicit permissions on them. Project items themselves are excluded from results -
/// only documents and chats are returned. Results are sorted to match the input entity order.
pub async fn expanded_soup_by_ids<'a>(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    entities: impl IntoIterator<Item = &'a Entity<'a>>,
) -> Result<Vec<SoupItem>, sqlx::Error> {
    let mut document_ids = Vec::new();
    let mut chat_ids = Vec::new();

    entities.into_iter().for_each(|e| match e.entity_type {
        EntityType::Chat => chat_ids.push(e.entity_id.to_string()),
        EntityType::Document => document_ids.push(e.entity_id.to_string()),
        EntityType::Project => {} // Projects are excluded from expanded soup
        _ => {}
    });

    if document_ids.is_empty() && chat_ids.is_empty() {
        return Ok(Vec::new());
    }

    let items: Vec<SoupItem> = sqlx::query!(
        r#"
        WITH RECURSIVE ProjectHierarchy AS (
            SELECT p.id, uia.access_level 
            FROM "Project" p
            JOIN "UserItemAccess" uia ON p.id = uia.item_id AND uia.item_type = 'project'
            WHERE uia.user_id = $1 AND p."deletedAt" IS NULL
            UNION ALL
            SELECT p.id, ph.access_level
            FROM "Project" p 
            JOIN ProjectHierarchy ph ON p."parentId" = ph.id
            WHERE p."deletedAt" IS NULL
        ),
        AllAccessGrants AS (
            SELECT item_id, item_type, access_level 
            FROM "UserItemAccess" 
            WHERE user_id = $1
            UNION ALL
            SELECT d.id AS item_id, 'document' AS item_type, ph.access_level
            FROM "Document" d 
            JOIN ProjectHierarchy ph ON d."projectId" = ph.id
            WHERE d."projectId" IS NOT NULL AND d."deletedAt" IS NULL
            UNION ALL
            SELECT c.id AS item_id, 'chat' AS item_type, ph.access_level
            FROM "Chat" c 
            JOIN ProjectHierarchy ph ON c."projectId" = ph.id
            WHERE c."projectId" IS NOT NULL AND c."deletedAt" IS NULL
            UNION ALL
            SELECT ph.id AS item_id, 'project' AS item_type, ph.access_level 
            FROM ProjectHierarchy ph
        ),
        UserAccessibleItems AS (
            SELECT DISTINCT ON (item_id, item_type) item_id, item_type
            FROM AllAccessGrants
            ORDER BY item_id, item_type, 
                CASE access_level
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
                uh."updatedAt"::timestamptz as "viewed_at"
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
            WHERE d."deletedAt" IS NULL
            AND d.id = ANY($2::text[])

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
                uh."updatedAt"::timestamptz as "viewed_at"
            FROM "Chat" c
            INNER JOIN UserAccessibleItems uai 
                ON uai.item_id = c.id 
                AND uai.item_type = 'chat'
            LEFT JOIN "UserHistory" uh 
                ON uh."itemId" = c.id 
                AND uh."itemType" = 'chat' 
                AND uh."userId" = $1
            WHERE c."deletedAt" IS NULL
            AND c.id = ANY($3::text[])
        )
        SELECT * 
        FROM Combined
        "#,
        user_id.as_ref(),        // $1
        document_ids.as_slice(), // $2
        chat_ids.as_slice(),     // $3
    )
    .try_map(|r| match r.item_type.as_ref() {
        "document" => Ok(SoupItem::Document(SoupDocument {
            id: Uuid::parse_str(&r.id).map_err(type_err)?,
            document_version_id: r
                .document_version_id
                .ok_or_else(|| type_err("document version id must exist"))
                .and_then(|s| FromStr::from_str(&s).map_err(type_err))?,
            owner_id: MacroUserIdStr::parse_from_str(&r.user_id)
                .map_err(type_err)?
                .into_owned(),
            name: r.name,
            file_type: r.file_type,
            sha: r.sha,
            project_id: r
                .project_id
                .as_deref()
                .map(Uuid::parse_str)
                .transpose()
                .map_err(type_err)?,
            branched_from_id: r
                .branched_from_id
                .as_deref()
                .map(Uuid::parse_str)
                .transpose()
                .map_err(type_err)?,
            branched_from_version_id: r.branched_from_version_id,
            document_family_id: r.document_family_id,
            created_at: r.created_at,
            updated_at: r.updated_at,
            viewed_at: r.viewed_at,
        })),
        "chat" => Ok(SoupItem::Chat(SoupChat {
            id: Uuid::parse_str(&r.id).map_err(type_err)?,
            name: r.name,
            owner_id: MacroUserIdStr::parse_from_str(&r.user_id)
                .map_err(type_err)?
                .into_owned(),
            project_id: r.project_id,
            is_persistent: r.is_persistent.unwrap_or_default(),
            created_at: r.created_at,
            updated_at: r.updated_at,
            viewed_at: r.viewed_at,
        })),
        _ => Err(sqlx::Error::TypeNotFound {
            type_name: r.item_type,
        }),
    })
    .fetch_all(db)
    .await?;

    Ok(items)
}
