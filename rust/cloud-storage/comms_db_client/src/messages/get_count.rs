use sqlx::{Executor, Postgres};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Returns the number of messages in the given channel.
///
/// Despite the name, this is a plain `COUNT(id)` and returns the actual row
/// count, not a 0/1 boolean. Callers that only need to know whether any
/// messages exist should compare against `0`.
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
