//! Soft-delete a chat.

use sqlx::{Postgres, Transaction};

/// Soft-delete a chat: remove pins and history, then set `deletedAt`.
#[tracing::instrument(err, skip(tx))]
pub(crate) async fn soft_delete_chat(
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

    sqlx::query!(
        r#"UPDATE "Chat" SET "deletedAt" = NOW() WHERE id = $1"#,
        chat_id,
    )
    .execute(tx.as_mut())
    .await?;

    Ok(())
}
