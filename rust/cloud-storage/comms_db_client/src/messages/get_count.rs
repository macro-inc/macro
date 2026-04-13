use sqlx::{Executor, Postgres};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Returns the total number of messages (including soft-deleted) in the
/// given channel.
#[tracing::instrument(skip(executor))]
pub async fn get_channel_message_count<'e, E>(executor: E, channel_id: &Uuid) -> anyhow::Result<i64>
where
    E: Executor<'e, Database = Postgres>,
{
    let count = sqlx::query!(
        r#"
        SELECT COUNT(id) as count FROM comms_messages
        WHERE channel_id = $1
        "#,
        channel_id
    )
    .map(|row| row.count.unwrap_or(0))
    .fetch_one(executor)
    .await?;

    Ok(count)
}
