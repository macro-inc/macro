/// Deletes a notification email sent record for a user
#[tracing::instrument(skip(db))]
pub async fn delete_notification_email_sent(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM notification_email_sent
        WHERE user_id = $1
        "#,
        user_id,
    )
    .execute(db)
    .await?;

    Ok(())
}
