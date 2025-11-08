use std::collections::HashSet;

/// Gets the notification email sent records for a list of users
#[tracing::instrument(skip(db))]
pub async fn get_notification_email_sent_bulk(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_ids: &[String],
) -> anyhow::Result<HashSet<String>> {
    let result: Vec<String> = sqlx::query!(
        r#"
        SELECT user_id
        FROM notification_email_sent
        WHERE user_id = ANY($1)
        "#,
        user_ids,
    )
    .map(|row| row.user_id)
    .fetch_all(db)
    .await?;

    Ok(result.into_iter().collect())
}
