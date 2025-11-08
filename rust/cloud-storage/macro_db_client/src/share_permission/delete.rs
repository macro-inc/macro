use sqlx::{Postgres, Transaction};

#[tracing::instrument(skip(transaction))]
pub async fn delete_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            DELETE FROM "SharePermission"
            WHERE "id" = $1
        "#,
        share_permission_id,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

#[tracing::instrument(skip(transaction))]
pub async fn delete_project_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
) -> anyhow::Result<()> {
    let share_permission_id = sqlx::query!(
        r#"
        SELECT pp."sharePermissionId" as id
        FROM "ProjectPermission" pp
        WHERE
            pp."projectId" = $1
        "#,
        project_id,
    )
    .map(|row| row.id)
    .fetch_one(transaction.as_mut())
    .await?;

    delete_share_permission(transaction, &share_permission_id).await
}

#[tracing::instrument(skip(transaction))]
pub async fn delete_document_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            DELETE FROM "DocumentPermission"
            WHERE "sharePermissionId" = $1
        "#,
        share_permission_id,
    )
    .execute(transaction.as_mut())
    .await?;

    delete_share_permission(transaction, share_permission_id).await
}

#[tracing::instrument(skip(transaction))]
pub async fn delete_chat_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            DELETE FROM "ChatPermission"
            WHERE "sharePermissionId" = $1
        "#,
        share_permission_id,
    )
    .execute(transaction.as_mut())
    .await?;

    delete_share_permission(transaction, share_permission_id).await
}
