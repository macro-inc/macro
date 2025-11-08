use sqlx::{Executor, Postgres};
use uuid::Uuid;

/// This will return 0 if there are no messages in the channel
/// This will return 1 if there is at least 1 message in the channel
#[tracing::instrument(skip(executor))]
pub async fn check_if_channel_has_messages<'e, E>(
    executor: E,
    channel_id: &Uuid,
) -> anyhow::Result<i64>
where
    E: Executor<'e, Database = Postgres>,
{
    let count = sqlx::query!(
        r#"
        SELECT COUNT(id) as count FROM comms_messages
        WHERE channel_id = $1
        LIMIT 1
        "#,
        channel_id
    )
    .map(|row| row.count.unwrap_or(0))
    .fetch_one(executor)
    .await?;

    Ok(count)
}
