pub async fn delete_chat(db: sqlx::PgPool, chat_id: &str) -> anyhow::Result<()> {
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

    sqlx::query!(
        r#"
        DELETE FROM "UserItemAccess"
        WHERE "item_id" = $1 AND "item_type" = $2
        "#,
        chat_id,
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

    transaction.commit().await?;

    Ok(())
}
