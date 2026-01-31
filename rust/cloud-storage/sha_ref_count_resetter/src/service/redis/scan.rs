use anyhow::Context;
use redis::AsyncCommands;

use crate::service::redis::SHA_COUNT_KEY_PREFIX_PATTERN;

/// Scans redis for all shas
#[tracing::instrument(skip(client))]
pub async fn scan(client: &redis::Client) -> anyhow::Result<Vec<String>> {
    let mut redis_connection = client
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;

    let result = redis_connection.keys(SHA_COUNT_KEY_PREFIX_PATTERN).await?;
    Ok(result)
}
