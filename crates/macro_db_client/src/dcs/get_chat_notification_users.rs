use sqlx::{Pool, Postgres};

/// Gets all users that need to be notified for a chat
/// This does not include the owner of the chat
#[tracing::instrument(skip(db))]
pub async fn get_chat_notification_users(
    db: &Pool<Postgres>,
    chat_id: &str,
) -> anyhow::Result<Vec<String>> {
    let users = sqlx::query!(
        r#"
        SELECT
            u."id" as id
            FROM "Chat" c
            INNER JOIN "UserHistory" uh ON uh."itemId" = c."id" AND uh."itemType" = 'chat'
            INNER JOIN "User" u ON u.id = uh."userId"
            WHERE c.id = $1 AND u.id != c."userId"
        "#,
        chat_id
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(users)
}
