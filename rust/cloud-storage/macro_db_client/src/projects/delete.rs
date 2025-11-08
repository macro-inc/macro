use super::get_project::get_project_chats::get_chats_from_project_ids;
use super::get_project::get_project_documents::get_documents_from_project_ids;
use anyhow::Context;
use sqlx::{Pool, Postgres, Transaction};

use super::get_project::get_sub_items::get_all_sub_project_ids;

/// Soft deletes a project.
/// Marks all items within the project and it's sub-projects as deleted.
/// Returns project_ids, document_ids, and chat_ids that were marked as deleted.
#[tracing::instrument(skip(db))]
pub async fn soft_delete_project(
    db: &Pool<Postgres>,
    project_id: &str,
) -> anyhow::Result<(Vec<String>, Vec<String>, Vec<String>)> {
    let mut transaction = db.begin().await.context("unable to begin transaction")?;

    let project_ids = get_all_sub_project_ids(&mut transaction, project_id).await?;
    let chat_ids = get_chats_from_project_ids(db, &project_ids).await?;
    let document_ids = get_documents_from_project_ids(db, &project_ids).await?;

    let combined_item_ids = project_ids
        .clone()
        .into_iter()
        .chain(chat_ids.clone())
        .chain(document_ids.clone())
        .collect::<Vec<String>>();

    tracing::trace!("deleting pins");
    sqlx::query!(
        r#"
        DELETE FROM "Pin" WHERE "pinnedItemId" = ANY($1)
        "#,
        &combined_item_ids,
    )
    .execute(&mut *transaction)
    .await?;

    tracing::trace!("deleting user history");
    sqlx::query!(
        r#"
        DELETE FROM "UserHistory" WHERE "itemId" = ANY($1)
        "#,
        &combined_item_ids,
    )
    .execute(&mut *transaction)
    .await?;

    let date = chrono::Utc::now().naive_utc();

    tracing::trace!("marking documents as deleted");
    sqlx::query!(
        r#"
        UPDATE "Document" SET "deletedAt" = $2 WHERE id = ANY($1);
        "#,
        &document_ids,
        &date
    )
    .execute(&mut *transaction)
    .await?;

    tracing::trace!("marking chats as deleted");
    sqlx::query!(
        r#"
        UPDATE "Chat" SET "deletedAt" = $2 WHERE id = ANY($1);
        "#,
        &chat_ids,
        &date
    )
    .execute(&mut *transaction)
    .await?;

    tracing::trace!("marking projects as deleted");
    sqlx::query!(
        r#"
        UPDATE "Project" SET "deletedAt" = $2 WHERE id = ANY($1);
        "#,
        &project_ids,
        &date
    )
    .execute(&mut *transaction)
    .await?;

    transaction
        .commit()
        .await
        .context("unable to commit transaction")?;

    Ok((project_ids, document_ids, chat_ids))
}

/// Hard deletes a project.
pub async fn delete_project(db: Pool<Postgres>, project_id: &str) -> anyhow::Result<()> {
    let mut transaction = db.begin().await?;

    // Delete pins
    sqlx::query!(
        r#"
        DELETE FROM "Pin" WHERE "pinnedItemId" = $1 AND "pinnedItemType" = $2
        "#,
        project_id,
        "project",
    )
    .execute(&mut *transaction)
    .await?;

    // Delete user history
    sqlx::query!(
        r#"
        DELETE FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = $2
        "#,
        project_id,
        "project",
    )
    .execute(&mut *transaction)
    .await?;

    // Get share permission if present
    let share_permission: Option<String> = sqlx::query!(
        r#"
            SELECT "sharePermissionId" as share_permission_id
            FROM "ProjectPermission"
            WHERE "projectId"=$1"#,
        project_id
    )
    .map(|row| row.share_permission_id)
    .fetch_optional(&mut *transaction)
    .await?;

    if let Some(share_permission) = share_permission {
        // Delete share permission
        sqlx::query!(
            r#"
            DELETE FROM "SharePermission" WHERE id = $1"#,
            share_permission
        )
        .execute(&mut *transaction)
        .await?;
    }

    crate::item_access::delete::delete_user_item_access_by_item(
        &mut transaction,
        project_id,
        "project",
    )
    .await?;

    sqlx::query!(
        r#"
        DELETE FROM "Project"
        WHERE id = $1"#,
        project_id
    )
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;

    Ok(())
}

#[tracing::instrument(skip(db))]
pub async fn delete_projects_bulk(
    db: &Pool<Postgres>,
    project_ids: &[String],
) -> anyhow::Result<()> {
    let mut transaction = db.begin().await.context("unable to begin transaction")?;

    sqlx::query!(
        r#"
            DELETE FROM "SharePermission"
            WHERE id IN (
                SELECT "sharePermissionId"
                FROM "ProjectPermission"
                WHERE "projectId" = ANY($1)
            )
        "#,
        project_ids
    )
    .execute(&mut *transaction)
    .await
    .context("unable to delete share permissions")?;

    crate::item_access::delete::delete_user_item_access_bulk(
        &mut transaction,
        project_ids,
        "project",
    )
    .await?;

    sqlx::query!(
        r#"
        DELETE FROM "Project"
        WHERE id = ANY($1)"#,
        project_ids
    )
    .execute(&mut *transaction)
    .await
    .context("unable to delete projects")?;

    transaction
        .commit()
        .await
        .context("unable to commit transaction")?;

    Ok(())
}

// delete projects in bulk
#[tracing::instrument(skip(transaction))]
pub async fn delete_projects_bulk_tsx(
    transaction: &mut Transaction<'_, Postgres>,
    project_ids: &[String],
) -> anyhow::Result<()> {
    if project_ids.is_empty() {
        return Ok(());
    }
    // Delete pins
    sqlx::query!(
        r#"
        DELETE FROM "Pin" WHERE "pinnedItemId" = ANY($1) AND "pinnedItemType" = $2
        "#,
        project_ids,
        "project",
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete user history
    sqlx::query!(
        r#"
        DELETE FROM "UserHistory" WHERE "itemId" = ANY($1) AND "itemType" = $2
        "#,
        project_ids,
        "project",
    )
    .execute(transaction.as_mut())
    .await?;

    sqlx::query!(
        r#"
            DELETE FROM "SharePermission"
            WHERE id IN (
                SELECT "sharePermissionId"
                FROM "ProjectPermission"
                WHERE "projectId" = ANY($1)
            )
        "#,
        project_ids
    )
    .execute(transaction.as_mut())
    .await
    .context("unable to delete share permissions")?;

    crate::item_access::delete::delete_user_item_access_bulk(transaction, project_ids, "project")
        .await?;

    sqlx::query!(
        r#"
        DELETE FROM "Project"
        WHERE id = ANY($1)"#,
        project_ids
    )
    .execute(transaction.as_mut())
    .await
    .context("unable to delete projects")?;

    Ok(())
}
