/// Creates a notification email sent record for a user
#[tracing::instrument(skip(db))]
pub async fn create_notification_email_sent(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO notification_email_sent (user_id)
        VALUES ($1)
        "#,
        user_id,
    )
    .execute(db)
    .await?;

    Ok(())
}
