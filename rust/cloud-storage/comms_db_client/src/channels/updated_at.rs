use anyhow::{Context, Result};
use uuid::Uuid;

/// Updates the updated_at timestamp for the given channel
/// to the current time
pub async fn updated_at<'e, E>(
    executor: E,
    channel_id: &Uuid,
) -> Result<chrono::DateTime<chrono::Utc>>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let now = chrono::Utc::now();
    sqlx::query!(
        r#"
        UPDATE comms_channels
        SET updated_at = $2 
        WHERE id = $1
        "#,
        channel_id,
        now
    )
    .execute(executor)
    .await
    .context("unable to update the channel updated_at timestamp")?;

    Ok(now)
}
