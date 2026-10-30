use chrono::Utc;
use sqlx::{Postgres, Transaction};

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

    let chat_uuid = macro_uuid::string_to_uuid(chat_id)?;
    entity_registry_db_utils::mark_deleted(tx, chat_uuid, Utc::now()).await?;

    Ok(())
}
