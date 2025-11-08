use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use sqlx::{Postgres, Transaction};

use crate::projects;
use crate::share_permission;

#[tracing::instrument(skip(transaction))]
pub async fn patch_chat(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    chat_id: &str,
    name: Option<&str>,
    model: Option<&str>,
    token_count: Option<&i64>,
    share_permissions: Option<&UpdateSharePermissionRequestV2>,
    project_id: Option<&str>,
) -> anyhow::Result<()> {
    patch_chat_transaction(
        transaction,
        chat_id,
        name,
        model,
        token_count,
        share_permissions,
    )
    .await?;

    if let Some(project_id) = project_id {
        projects::move_item::move_item_to_project(transaction, project_id, chat_id, "chat").await?;
    }
    Ok(())
}

/// Patches a chat
#[tracing::instrument(skip(transaction))]
pub async fn patch_chat_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    chat_id: &str,
    name: Option<&str>,
    model: Option<&str>,
    token_count: Option<&i64>,
    share_permissions: Option<&UpdateSharePermissionRequestV2>,
) -> anyhow::Result<()> {
    // Update compare updated at time
    sqlx::query!(
        r#"
        UPDATE "Chat" SET "updatedAt" = NOW()
        WHERE id = $1
        "#,
        chat_id,
    )
    .execute(transaction.as_mut())
    .await?;

    if let Some(name) = name {
        sqlx::query!(
            r#"
            UPDATE "Chat" SET "name" = $1
            WHERE id = $2
            "#,
            name,
            chat_id,
        )
        .execute(transaction.as_mut())
        .await?;
    }

    if let Some(model) = model {
        sqlx::query!(
            r#"
            UPDATE "Chat" SET "model" = $1
            WHERE id = $2
            "#,
            model,
            chat_id,
        )
        .execute(transaction.as_mut())
        .await?;
    }

    if let Some(token_count) = token_count {
        sqlx::query!(
            r#"
            UPDATE "Chat" SET "tokenCount" = $1
            WHERE id = $2
            "#,
            token_count,
            chat_id,
        )
        .execute(transaction.as_mut())
        .await?;
    }

    if let Some(share_permissions) = share_permissions {
        share_permission::edit::edit_chat_permission(transaction, chat_id, share_permissions)
            .await?;
    }
    Ok(())
}

pub async fn update_chat_token_count(
    transaction: &mut Transaction<'_, Postgres>,
    chat_id: &str,
    token_count: i64,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE "Chat" SET "tokenCount" = $1
        WHERE id = $2
        "#,
        token_count,
        chat_id,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}
