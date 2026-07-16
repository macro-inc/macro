use chrono::Utc;
use sqlx::{Postgres, Transaction};

use crate::domain::models::{PurgedProjectTree, SoftDeleteResult};

pub(super) async fn purge_deleted_project_tree(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
) -> Result<PurgedProjectTree, sqlx::Error> {
    let project_ids = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT id
            FROM "Project"
            WHERE id = $1 AND "deletedAt" IS NOT NULL
            UNION ALL
            SELECT child.id
            FROM "Project" child
            JOIN project_hierarchy parent ON child."parentId" = parent.id
            WHERE child."deletedAt" IS NOT NULL
        )
        SELECT id AS "id!" FROM project_hierarchy
        "#,
        project_id,
    )
    .fetch_all(transaction.as_mut())
    .await?;

    let documents = sqlx::query!(
        r#"
        SELECT id, owner
        FROM "Document"
        WHERE "projectId" = ANY($1) AND "deletedAt" IS NOT NULL
        "#,
        &project_ids,
    )
    .map(|row| (row.id, row.owner))
    .fetch_all(transaction.as_mut())
    .await?;
    let document_ids = documents
        .iter()
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    let chat_ids = sqlx::query_scalar!(
        r#"
        SELECT id
        FROM "Chat"
        WHERE "projectId" = ANY($1) AND "deletedAt" IS NOT NULL
        "#,
        &project_ids,
    )
    .fetch_all(transaction.as_mut())
    .await?;
    let bom_shas = sqlx::query!(
        r#"
        SELECT part.sha, COUNT(*) AS "count!"
        FROM "BomPart" part
        JOIN "DocumentBom" bom ON bom.id = part."documentBomId"
        WHERE bom."documentId" = ANY($1)
        GROUP BY part.sha
        ORDER BY part.sha
        "#,
        &document_ids,
    )
    .map(|row| (row.sha, row.count))
    .fetch_all(transaction.as_mut())
    .await?;

    delete_items(transaction, &project_ids, &document_ids, &chat_ids).await?;

    Ok(PurgedProjectTree {
        project_ids,
        chat_ids,
        documents,
        bom_shas,
    })
}

pub(super) async fn delete_uploaded_tree(
    transaction: &mut Transaction<'_, Postgres>,
    project_ids: &[String],
    document_ids: &[String],
) -> Result<(), sqlx::Error> {
    delete_items(transaction, project_ids, document_ids, &[]).await
}

async fn delete_items(
    transaction: &mut Transaction<'_, Postgres>,
    project_ids: &[String],
    document_ids: &[String],
    chat_ids: &[String],
) -> Result<(), sqlx::Error> {
    let all_ids = project_ids
        .iter()
        .chain(document_ids)
        .chain(chat_ids)
        .cloned()
        .collect::<Vec<_>>();

    sqlx::query!(
        r#"DELETE FROM "Pin" WHERE "pinnedItemId" = ANY($1)"#,
        &all_ids
    )
    .execute(transaction.as_mut())
    .await?;
    sqlx::query!(
        r#"DELETE FROM "UserHistory" WHERE "itemId" = ANY($1)"#,
        &all_ids
    )
    .execute(transaction.as_mut())
    .await?;
    sqlx::query!(
        r#"
        DELETE FROM "SharePermission"
        WHERE id IN (
            SELECT "sharePermissionId" FROM "ProjectPermission" WHERE "projectId" = ANY($1)
            UNION
            SELECT "sharePermissionId" FROM "DocumentPermission" WHERE "documentId" = ANY($2)
            UNION
            SELECT "sharePermissionId" FROM "ChatPermission" WHERE "chatId" = ANY($3)
        )
        "#,
        project_ids,
        document_ids,
        chat_ids,
    )
    .execute(transaction.as_mut())
    .await?;
    sqlx::query!(
        r#"
        DELETE FROM entity_access
        WHERE entity_id::text = ANY($1)
           OR "granted_from_project_id" = ANY($2)
        "#,
        &all_ids,
        project_ids,
    )
    .execute(transaction.as_mut())
    .await?;
    sqlx::query!(r#"DELETE FROM "Document" WHERE id = ANY($1)"#, document_ids)
        .execute(transaction.as_mut())
        .await?;
    sqlx::query!(r#"DELETE FROM "Chat" WHERE id = ANY($1)"#, chat_ids)
        .execute(transaction.as_mut())
        .await?;
    sqlx::query!(r#"DELETE FROM "Project" WHERE id = ANY($1)"#, project_ids)
        .execute(transaction.as_mut())
        .await?;
    Ok(())
}

pub(super) async fn soft_delete_project(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
) -> Result<SoftDeleteResult, sqlx::Error> {
    let project_ids = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT id FROM "Project" WHERE id = $1 AND "deletedAt" IS NULL
            UNION ALL
            SELECT child.id
            FROM "Project" child
            JOIN project_hierarchy parent ON child."parentId" = parent.id
            WHERE child."deletedAt" IS NULL
        )
        SELECT id AS "id!" FROM project_hierarchy
        "#,
        project_id,
    )
    .fetch_all(transaction.as_mut())
    .await?;

    // Unlike the legacy implementation, child reads use the same transaction
    // as the writes. This intentionally removes read skew during concurrent moves.
    let document_ids = sqlx::query_scalar!(
        r#"SELECT id FROM "Document" WHERE "projectId" = ANY($1)"#,
        &project_ids,
    )
    .fetch_all(transaction.as_mut())
    .await?;
    let chat_ids = sqlx::query_scalar!(
        r#"SELECT id FROM "Chat" WHERE "projectId" = ANY($1)"#,
        &project_ids,
    )
    .fetch_all(transaction.as_mut())
    .await?;

    let all_ids = project_ids
        .iter()
        .chain(&document_ids)
        .chain(&chat_ids)
        .cloned()
        .collect::<Vec<_>>();
    sqlx::query!(
        r#"DELETE FROM "Pin" WHERE "pinnedItemId" = ANY($1)"#,
        &all_ids
    )
    .execute(transaction.as_mut())
    .await?;
    sqlx::query!(
        r#"DELETE FROM "UserHistory" WHERE "itemId" = ANY($1)"#,
        &all_ids,
    )
    .execute(transaction.as_mut())
    .await?;

    let deleted_at = Utc::now().naive_utc();
    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = $2 WHERE id = ANY($1)"#,
        &document_ids,
        deleted_at,
    )
    .execute(transaction.as_mut())
    .await?;
    sqlx::query!(
        r#"UPDATE "Chat" SET "deletedAt" = $2 WHERE id = ANY($1)"#,
        &chat_ids,
        deleted_at,
    )
    .execute(transaction.as_mut())
    .await?;
    sqlx::query!(
        r#"UPDATE "Project" SET "deletedAt" = $2 WHERE id = ANY($1)"#,
        &project_ids,
        deleted_at,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(SoftDeleteResult {
        project_ids,
        document_ids,
        chat_ids,
    })
}
