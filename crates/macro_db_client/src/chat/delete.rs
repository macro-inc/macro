use model_entity::EntityType;
use sqlx::{Postgres, Transaction};

/// Soft deletes a chat
#[tracing::instrument(skip(db))]
pub async fn soft_delete_chat(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_id: &str,
) -> anyhow::Result<()> {
    entity_access_db_utils::transaction_retry::on_conflict(
        || async {
            let mut transaction = db.begin().await?;

            // Delete pins
            sqlx::query!(
                r#"
                DELETE FROM "Pin" WHERE "pinnedItemId" = $1 AND "pinnedItemType" = $2
                "#,
                chat_id,
                "chat",
            )
            .execute(&mut *transaction)
            .await?;

            // Delete user history
            sqlx::query!(
                r#"
                DELETE FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = $2
                "#,
                chat_id,
                "chat",
            )
            .execute(&mut *transaction)
            .await?;

            sqlx::query!(
                r#"
                UPDATE "Chat" SET "deletedAt" = NOW() WHERE id = $1"#,
                chat_id
            )
            .execute(&mut *transaction)
            .await?;

            source_items::sync_one(
                transaction.as_mut(),
                model_entity::EntityType::Chat,
                chat_id,
            )
            .await?;
            transaction.commit().await?;

            Ok(())
        },
        |error: &anyhow::Error| {
            entity_access_db_utils::transaction_retry::is_transaction_conflict(error.as_ref())
        },
    )
    .await
}

/// Bulk deletes chats
pub async fn delete_chat_bulk_tsx(
    transaction: &mut Transaction<'_, Postgres>,
    chat_ids: &[String],
) -> anyhow::Result<()> {
    if chat_ids.is_empty() {
        return Ok(());
    }
    // Delete pins
    sqlx::query!(
        r#"
        DELETE FROM "Pin" WHERE "pinnedItemId" = ANY($1) AND "pinnedItemType" = $2
        "#,
        chat_ids,
        "chat",
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete user history
    sqlx::query!(
        r#"
        DELETE FROM "UserHistory" WHERE "itemId" = ANY($1) AND "itemType" = $2
        "#,
        chat_ids,
        "chat",
    )
    .execute(transaction.as_mut())
    .await?;

    sqlx::query!(
        r#"
            DELETE FROM "SharePermission"
            WHERE id IN (
                SELECT "sharePermissionId"
                FROM "ChatPermission"
                WHERE "chatId" = ANY($1)
            )
        "#,
        chat_ids
    )
    .execute(transaction.as_mut())
    .await?;

    crate::item_access::delete::delete_user_entity_access_bulk(
        transaction,
        &chat_ids
            .iter()
            .filter_map(|p| macro_uuid::string_to_uuid(p).ok())
            .collect::<Vec<uuid::Uuid>>(),
        EntityType::Chat,
    )
    .await?;

    sqlx::query!(
        r#"
        DELETE FROM "Chat"
        WHERE id = ANY($1)"#,
        chat_ids
    )
    .execute(transaction.as_mut())
    .await?;

    source_items::sync_many(
        transaction.as_mut(),
        model_entity::EntityType::Chat,
        chat_ids,
    )
    .await?;

    Ok(())
}

/// Deletes a chat
#[tracing::instrument(skip(db))]
pub async fn delete_chat(db: &sqlx::Pool<sqlx::Postgres>, chat_id: &str) -> anyhow::Result<()> {
    entity_access_db_utils::transaction_retry::on_conflict(
        || async {
            let mut transaction = db.begin().await?;

            // Delete pins
            sqlx::query!(
                r#"
                DELETE FROM "Pin" WHERE "pinnedItemId" = $1 AND "pinnedItemType" = $2
                "#,
                chat_id,
                "chat",
            )
            .execute(&mut *transaction)
            .await?;

            // Delete user history
            sqlx::query!(
                r#"
                DELETE FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = $2
                "#,
                chat_id,
                "chat",
            )
            .execute(&mut *transaction)
            .await?;

            // Get share permission if present
            let share_permission: Option<String> = sqlx::query!(
                r#"
                    SELECT "sharePermissionId" as share_permission_id
                    FROM "ChatPermission"
                    WHERE "chatId"=$1"#,
                chat_id
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

            crate::item_access::delete::delete_user_entity_access_by_item(
                &mut transaction,
                &macro_uuid::string_to_uuid(chat_id).unwrap(),
                EntityType::Chat,
            )
            .await?;

            sqlx::query!(
                r#"
                DELETE FROM "Chat"
                WHERE id = $1"#,
                chat_id
            )
            .execute(&mut *transaction)
            .await?;

            source_items::sync_one(
                transaction.as_mut(),
                model_entity::EntityType::Chat,
                chat_id,
            )
            .await?;
            transaction.commit().await?;

            Ok(())
        },
        |error: &anyhow::Error| {
            entity_access_db_utils::transaction_retry::is_transaction_conflict(error.as_ref())
        },
    )
    .await
}
