pub async fn delete_chat(db: sqlx::PgPool, chat_id: &str) -> anyhow::Result<()> {
    entity_access_db_utils::transaction_retry::on_conflict(
        || async {
            let mut transaction = db.begin().await?;

            sqlx::query!(
                r#"
                DELETE FROM "Pin" WHERE "pinnedItemId" = $1 AND "pinnedItemType" = $2
                "#,
                chat_id,
                "chat",
            )
            .execute(&mut *transaction)
            .await?;

            sqlx::query!(
                r#"
                DELETE FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = $2
                "#,
                chat_id,
                "chat",
            )
            .execute(&mut *transaction)
            .await?;

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
                sqlx::query!(
                    r#"
                    DELETE FROM "SharePermission" WHERE id = $1"#,
                    share_permission
                )
                .execute(&mut *transaction)
                .await?;
            }

            let chat_uuid = macro_uuid::string_to_uuid(chat_id)?;
            sqlx::query!(
                r#"
                DELETE FROM "entity_access"
                WHERE "entity_id" = $1 AND "entity_type" = $2
                "#,
                chat_uuid,
                "chat",
            )
            .execute(&mut *transaction)
            .await?;

            sqlx::query!(
                r#"
                DELETE FROM "Chat"
                WHERE id = $1"#,
                chat_id
            )
            .execute(&mut *transaction)
            .await?;

            entity_registry_db_utils::delete_entity(&mut transaction, chat_uuid).await?;

            source_items::sync_one(
                transaction.as_mut(),
                entity_access_db_utils::EntityType::Chat,
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

#[cfg(test)]
mod test;
