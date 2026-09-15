use model_entity::EntityType;
use sqlx::{Postgres, Transaction};

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

    let chat_uuid = macro_uuid::string_to_uuid(chat_id)?;
    sqlx::query!(
        r#"DELETE FROM "entity_access" WHERE "entity_id" = $1 AND "entity_type" = $2"#,
        chat_uuid,
        EntityType::Chat.as_ref(),
    )
    .execute(tx.as_mut())
    .await?;

    sqlx::query!(r#"DELETE FROM "Chat" WHERE id = $1"#, chat_id,)
        .execute(tx.as_mut())
        .await?;

    entity_registry_db_utils::delete_entity(tx, chat_uuid).await?;

    Ok(())
}
