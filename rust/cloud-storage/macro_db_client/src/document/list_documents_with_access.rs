use model::document::list::{DocumentListFilters, DocumentListItem};
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Pool, Postgres};
use std::str::FromStr;

/// Lists documents the user has access to with optional filtering and pagination
#[tracing::instrument(skip(db, filters, min_access_level, offset, limit))]
pub async fn list_documents_with_access(
    db: &Pool<Postgres>,
    user_id: &str,
    filters: &DocumentListFilters,
    min_access_level: AccessLevel,
    offset: i64,
    limit: i64,
) -> anyhow::Result<Vec<DocumentListItem>> {
    // Convert file types for query - SQLx needs Option<&[String]>
    let file_types_array = filters.file_types.as_deref();
    let min_access_level_str = min_access_level.to_string().to_lowercase();

    let documents: Vec<DocumentListItem> = sqlx::query!(
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
            WHERE user_id = $1 AND item_type = 'document'
            UNION ALL
            SELECT d.id AS item_id, 'document' AS item_type, ph.access_level
            FROM "Document" d 
            JOIN ProjectHierarchy ph ON d."projectId" = ph.id
            WHERE d."projectId" IS NOT NULL AND d."deletedAt" IS NULL
        ),
        UserAccessibleDocuments AS (
            SELECT DISTINCT ON (item_id) item_id, access_level
            FROM AllAccessGrants
            ORDER BY item_id, 
                CASE access_level
                    WHEN 'owner' THEN 4
                    WHEN 'edit' THEN 3 
                    WHEN 'comment' THEN 2
                    WHEN 'view' THEN 1
                    ELSE 0
                END DESC
        )
        SELECT
            d.id as "document_id!",
            d.name as "document_name!",
            d.owner as "owner!",
            d."fileType" as "file_type",
            d."projectId" as "project_id",
            d."createdAt"::timestamptz as "created_at!",
            d."updatedAt"::timestamptz as "updated_at!",
            d."deletedAt"::timestamptz as "deleted_at",
            uad.access_level::text as "access_level!"
        FROM "Document" d
        INNER JOIN UserAccessibleDocuments uad ON uad.item_id = d.id
        WHERE d."deletedAt" IS NULL
        AND ($2::text[] IS NULL OR d."fileType" = ANY($2))
        AND (
            CASE uad.access_level::text
                WHEN 'owner' THEN 4
                WHEN 'edit' THEN 3
                WHEN 'comment' THEN 2
                WHEN 'view' THEN 1
                ELSE 0
            END >= 
            CASE $3
                WHEN 'owner' THEN 4
                WHEN 'edit' THEN 3
                WHEN 'comment' THEN 2
                WHEN 'view' THEN 1
                ELSE 0
            END
        )
        ORDER BY d."updatedAt" DESC
        LIMIT $4 OFFSET $5
        "#,
        user_id,              // $1
        file_types_array,     // $2
        min_access_level_str, // $3
        limit,                // $4
        offset,               // $5
    )
    .try_map(|row| {
        let access_level =
            AccessLevel::from_str(&row.access_level).map_err(|e| sqlx::Error::TypeNotFound {
                type_name: e.to_string(),
            })?;

        Ok(DocumentListItem {
            document_id: row.document_id,
            document_name: row.document_name,
            owner: row.owner,
            file_type: row.file_type,
            project_id: row.project_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            access_level,
        })
    })
    .fetch_all(db)
    .await?;

    Ok(documents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use model::document::list::DocumentListFilters;
    use models_permissions::share_permission::access_level::AccessLevel;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_lots_of_documents")))]
    async fn test_list_documents_with_access_owned_documents(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let filters = DocumentListFilters::default();
        let documents = list_documents_with_access(
            &pool,
            "macro|user@user.com",
            &filters,
            AccessLevel::View,
            0,
            10,
        )
        .await?;

        // Should return documents owned by the user
        assert!(!documents.is_empty());

        // All returned documents should have the user as owner or have access
        for doc in &documents {
            assert!(
                doc.owner == "macro|user@user.com" || doc.access_level >= AccessLevel::View,
                "Document {} should be owned by user or have access",
                doc.document_id
            );
        }

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_lots_of_documents")))]
    async fn test_list_documents_with_file_type_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let filters = DocumentListFilters {
            file_types: Some(vec!["md".to_string()]),
        };

        let documents = list_documents_with_access(
            &pool,
            "macro|user@user.com",
            &filters,
            AccessLevel::View,
            0,
            10,
        )
        .await?;

        // All returned documents should be markdown files
        for doc in &documents {
            assert_eq!(
                doc.file_type.as_deref(),
                Some("md"),
                "Document {} should be a markdown file",
                doc.document_id
            );
        }

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_lots_of_documents")))]
    async fn test_list_documents_with_pagination(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let filters = DocumentListFilters::default();

        // Get first page
        let page1 = list_documents_with_access(
            &pool,
            "macro|user@user.com",
            &filters,
            AccessLevel::View,
            0,
            3,
        )
        .await?;

        // Get second page
        let page2 = list_documents_with_access(
            &pool,
            "macro|user@user.com",
            &filters,
            AccessLevel::View,
            3,
            3,
        )
        .await?;

        // Pages should be different
        assert_eq!(page1.len(), 3);
        assert!(!page2.is_empty());

        // No overlap between pages
        let page1_ids: std::collections::HashSet<_> =
            page1.iter().map(|d| &d.document_id).collect();
        let page2_ids: std::collections::HashSet<_> =
            page2.iter().map(|d| &d.document_id).collect();

        assert!(page1_ids.is_disjoint(&page2_ids));

        Ok(())
    }
}
