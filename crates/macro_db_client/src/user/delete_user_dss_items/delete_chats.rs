use model_entity::EntityType;

/// Deletes all chats for a user
/// Does not commit the transaction
#[tracing::instrument(skip(transaction))]
pub async fn delete_user_chats(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<()> {
    let user_chats = sqlx::query!(
        r#"
        SELECT id FROM "Chat" WHERE "userId" = $1
    "#,
        user_id
    )
    .map(|row| row.id)
    .fetch_all(transaction.as_mut())
    .await?;

    // Delete pins
    sqlx::query!(
        r#"
        DELETE FROM "Pin" 
        WHERE "pinnedItemId" = ANY($1) AND "pinnedItemType" = $2
        "#,
        &user_chats,
        "chat"
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete user history
    sqlx::query!(
        r#"
        DELETE FROM "UserHistory" 
        WHERE "itemId" = ANY($1) AND "itemType" = $2
        "#,
        &user_chats,
        "chat"
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete permissions
    sqlx::query!(
        r#"
        DELETE FROM "SharePermission" sp
        USING "ChatPermission" cp 
        WHERE cp."sharePermissionId" = sp.id
        AND cp."chatId" = ANY($1)
    "#,
        &user_chats
    )
    .execute(transaction.as_mut())
    .await?;

    let chat_uuids = user_chats
        .iter()
        .filter_map(|id| macro_uuid::string_to_uuid(id).ok())
        .collect::<Vec<_>>();
    crate::item_access::delete::delete_user_entity_access_bulk(
        transaction,
        &chat_uuids,
        EntityType::Chat,
    )
    .await?;

    // Delete chats
    sqlx::query!(
        r#"
        DELETE FROM "Chat" 
        WHERE id = ANY($1)
        "#,
        &user_chats
    )
    .execute(transaction.as_mut())
    .await?;

    for chat_uuid in chat_uuids {
        entity_registry_db_utils::delete_entity(transaction, chat_uuid).await?;
    }

    Ok(())
}
