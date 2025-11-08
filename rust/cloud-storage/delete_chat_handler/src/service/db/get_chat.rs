pub async fn is_chat_deleted(db: sqlx::PgPool, chat_id: &str) -> anyhow::Result<bool> {
    let is_deleted = sqlx::query!(
        r#"
        SELECT "deletedAt" as "deleted_at"
        FROM "Chat"
        WHERE id = $1
    "#,
        chat_id
    )
    .map(|r| r.deleted_at.is_some())
    .fetch_one(&db)
    .await?;

    Ok(is_deleted)
}
