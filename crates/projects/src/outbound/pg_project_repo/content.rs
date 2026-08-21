use document_sub_type::DocumentSubType;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model::chat::Chat;
use model::document::{BasicDocument, BasicDocumentSubType};
use model::item::Item;
use model::project::Project;
use sqlx::PgPool;
use system_properties::{StatusOption, SystemPropertyKey};

pub(super) async fn get_project_children(
    pool: &PgPool,
    project_id: &str,
) -> Result<Vec<Item>, sqlx::Error> {
    let projects = get_sub_projects(pool, project_id).await?;
    let documents = get_sub_documents(pool, project_id).await?;
    let chats = get_sub_chats(pool, project_id).await?;

    let mut children = Vec::with_capacity(projects.len() + documents.len() + chats.len());
    children.extend(projects.into_iter().map(Item::Project));
    children.extend(documents.into_iter().map(Item::Document));
    children.extend(chats.into_iter().map(Item::Chat));
    Ok(children)
}

async fn get_sub_projects(pool: &PgPool, project_id: &str) -> Result<Vec<Project>, sqlx::Error> {
    sqlx::query_as!(
        Project,
        r#"
        SELECT
            p.id,
            p.name,
            p."userId" AS "user_id",
            p."parentId" AS "parent_id?",
            p."createdAt"::timestamptz AS "created_at",
            p."updatedAt"::timestamptz AS "updated_at",
            p."deletedAt"::timestamptz AS "deleted_at"
        FROM "Project" p
        WHERE p."parentId" = $1 AND p."deletedAt" IS NULL
        ORDER BY p."createdAt" ASC, p.id ASC
        "#,
        project_id,
    )
    .fetch_all(pool)
    .await
}

async fn get_sub_documents(
    pool: &PgPool,
    project_id: &str,
) -> Result<Vec<BasicDocument>, sqlx::Error> {
    let completed_option_id = StatusOption::COMPLETED_UUID.to_string();
    let status_property_id = SystemPropertyKey::STATUS_UUID;

    sqlx::query!(
        r#"
        SELECT
            d.id AS "document_id",
            d.owner,
            d.name AS "document_name",
            COALESCE(bom.id, instance.id) AS "document_version_id!",
            d."fileType" AS "file_type?",
            d."createdAt"::timestamptz AS "created_at",
            d."updatedAt"::timestamptz AS "updated_at",
            d."projectId" AS "project_id?",
            subtype.sub_type AS "sub_type?: DocumentSubType",
            CASE
                WHEN subtype.sub_type = 'task'
                    AND status.values->'value' ? $2
                THEN true
                WHEN subtype.sub_type = 'task' THEN false
                ELSE NULL
            END AS "is_completed"
        FROM "Document" d
        LEFT JOIN document_sub_type subtype ON subtype.document_id = d.id
        LEFT JOIN entity_properties status
            ON subtype.sub_type = 'task'
            AND status.entity_id = d.id
            AND status.entity_type = 'TASK'
            AND status.property_definition_id = $3
        LEFT JOIN LATERAL (
            SELECT b.id
            FROM "DocumentBom" b
            WHERE b."documentId" = d.id
            ORDER BY b."createdAt" DESC
            LIMIT 1
        ) bom ON d."fileType" = 'docx'
        LEFT JOIN LATERAL (
            SELECT i.id
            FROM "DocumentInstance" i
            WHERE i."documentId" = d.id
            ORDER BY i."updatedAt" DESC
            LIMIT 1
        ) instance ON d."fileType" IS DISTINCT FROM 'docx'
        WHERE d."projectId" = $1 AND d."deletedAt" IS NULL
        ORDER BY d."createdAt" ASC, d.id ASC
        "#,
        project_id,
        completed_option_id,
        status_property_id,
    )
    .try_map(|row| {
        Ok(BasicDocument {
            document_id: row.document_id,
            document_version_id: row.document_version_id,
            owner: MacroUserIdStr::parse_from_str(&row.owner)
                .map_err(|error| sqlx::Error::Decode(Box::new(error)))?
                .into_owned(),
            document_name: row.document_name,
            file_type: row.file_type,
            project_id: row.project_id,
            sha: None,
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: None,
            sub_type: BasicDocumentSubType::from_db(row.sub_type, row.is_completed),
        })
    })
    .fetch_all(pool)
    .await
}

async fn get_sub_chats(pool: &PgPool, project_id: &str) -> Result<Vec<Chat>, sqlx::Error> {
    sqlx::query_as!(
        Chat,
        r#"
        SELECT
            c.id,
            c.name,
            c."userId" AS "user_id",
            c.model AS "model?",
            c."projectId" AS "project_id?",
            c."tokenCount" AS "token_count",
            c."createdAt"::timestamptz AS "created_at",
            c."updatedAt"::timestamptz AS "updated_at",
            c."deletedAt"::timestamptz AS "deleted_at",
            c."isPersistent" AS "is_persistent"
        FROM "Chat" c
        WHERE c."projectId" = $1 AND c."deletedAt" IS NULL
        ORDER BY c."createdAt" ASC, c.id ASC
        "#,
        project_id,
    )
    .fetch_all(pool)
    .await
}
