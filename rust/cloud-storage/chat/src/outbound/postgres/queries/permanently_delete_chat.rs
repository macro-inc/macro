//! Permanently delete a chat and all associated data.

use sqlx::{Postgres, Transaction};

/// Hard-delete a chat: remove pins, history, permissions, access, and the chat row.
#[tracing::instrument(err, skip(tx))]
pub(crate) async fn permanently_delete_chat(
    tx: &mut Transaction<'_, Postgres>,
    chat_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"DELETE FROM "Pin" WHERE "pinnedItemId" = $1 AND "pinnedItemType" = 'chat'"#,
        chat_id,
    )
    .execute(tx.as_mut())
    .await?;

    sqlx::query!(
        r#"DELETE FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = 'chat'"#,
        chat_id,
    )
    .execute(tx.as_mut())
    .await?;

    // Delete share permission (cascades ChatPermission)
    sqlx::query!(
        r#"
        DELETE FROM "SharePermission"
        WHERE id IN (
            SELECT "sharePermissionId"
            FROM "ChatPermission"
            WHERE "chatId" = $1
        )
        "#,
        chat_id,
    )
    .execute(tx.as_mut())
    .await?;

    sqlx::query!(
        r#"DELETE FROM "UserItemAccess" WHERE "item_id" = $1 AND "item_type" = 'chat'"#,
        chat_id,
    )
    .execute(tx.as_mut())
    .await?;

    sqlx::query!(r#"DELETE FROM "Chat" WHERE id = $1"#, chat_id,)
        .execute(tx.as_mut())
        .await?;

    Ok(())
}
