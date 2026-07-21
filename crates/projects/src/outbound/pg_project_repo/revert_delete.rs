use sqlx::{Postgres, Transaction};

use crate::domain::models::RevertDeleteResult;

pub(super) async fn revert_delete_project(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
    previous_parent_id: Option<&str>,
) -> Result<RevertDeleteResult, sqlx::Error> {
    let projects = sqlx::query!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT id, "userId" AS user_id
            FROM "Project" WHERE id = $1 AND "deletedAt" IS NOT NULL
            UNION ALL
            SELECT child.id, child."userId" AS user_id
            FROM "Project" child
            JOIN project_hierarchy parent ON child."parentId" = parent.id
            WHERE child."deletedAt" IS NOT NULL
        )
        SELECT id AS "id!", user_id AS "user_id!" FROM project_hierarchy
        "#,
        project_id,
    )
    .fetch_all(transaction.as_mut())
    .await?;
    let project_ids = projects
        .iter()
        .map(|row| row.id.clone())
        .collect::<Vec<_>>();
    let project_owner_ids = projects
        .iter()
        .map(|row| row.user_id.clone())
        .collect::<Vec<_>>();

    // Child reads deliberately remain inside this transaction so restoration
    // observes one consistent subtree rather than the legacy read-skew window.
    let documents = sqlx::query!(
        r#"
        SELECT id, owner FROM "Document"
        WHERE "projectId" = ANY($1) AND "deletedAt" IS NOT NULL
        "#,
        &project_ids,
    )
    .fetch_all(transaction.as_mut())
    .await?;
    let chats = sqlx::query!(
        r#"
        SELECT id, "userId" AS user_id FROM "Chat"
        WHERE "projectId" = ANY($1) AND "deletedAt" IS NOT NULL
        "#,
        &project_ids,
    )
    .fetch_all(transaction.as_mut())
    .await?;
    let document_ids = documents
        .iter()
        .map(|row| row.id.clone())
        .collect::<Vec<_>>();
    let document_owner_ids = documents
        .iter()
        .map(|row| row.owner.clone())
        .collect::<Vec<_>>();
    let chat_ids = chats.iter().map(|row| row.id.clone()).collect::<Vec<_>>();
    let chat_owner_ids = chats
        .iter()
        .map(|row| row.user_id.clone())
        .collect::<Vec<_>>();

    restore_items(transaction, "chat", &chat_ids, &chat_owner_ids).await?;
    restore_items(transaction, "document", &document_ids, &document_owner_ids).await?;
    restore_items(transaction, "project", &project_ids, &project_owner_ids).await?;

    if let Some(parent_id) = previous_parent_id {
        let parent_is_deleted = sqlx::query_scalar!(
            r#"SELECT "deletedAt" IS NOT NULL AS "is_deleted!" FROM "Project" WHERE id = $1"#,
            parent_id,
        )
        .fetch_optional(transaction.as_mut())
        .await?
        .unwrap_or(false);
        if parent_is_deleted {
            sqlx::query!(
                r#"UPDATE "Project" SET "parentId" = NULL WHERE id = $1"#,
                project_id,
            )
            .execute(transaction.as_mut())
            .await?;
        }
    }

    Ok(RevertDeleteResult { project_ids })
}

async fn restore_items(
    transaction: &mut Transaction<'_, Postgres>,
    item_type: &str,
    item_ids: &[String],
    owner_ids: &[String],
) -> Result<(), sqlx::Error> {
    match item_type {
        "chat" => {
            sqlx::query!(
                r#"UPDATE "Chat" SET "deletedAt" = NULL WHERE id = ANY($1)"#,
                item_ids
            )
            .execute(transaction.as_mut())
            .await?
        }
        "document" => {
            sqlx::query!(
                r#"UPDATE "Document" SET "deletedAt" = NULL WHERE id = ANY($1)"#,
                item_ids
            )
            .execute(transaction.as_mut())
            .await?
        }
        "project" => {
            sqlx::query!(
                r#"UPDATE "Project" SET "deletedAt" = NULL WHERE id = ANY($1)"#,
                item_ids
            )
            .execute(transaction.as_mut())
            .await?
        }
        _ => unreachable!("known item type"),
    };
    sqlx::query!(
        r#"
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        SELECT value.owner_id, value.item_id, $3, NOW(), NOW()
        FROM UNNEST($1::text[], $2::text[]) AS value(item_id, owner_id)
        ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE
        SET "updatedAt" = NOW()
        "#,
        item_ids,
        owner_ids,
        item_type,
    )
    .execute(transaction.as_mut())
    .await?;
    Ok(())
}
