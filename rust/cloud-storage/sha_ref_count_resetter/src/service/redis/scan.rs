use anyhow::Context;
use redis::AsyncCommands;

use crate::service::redis::SHA_COUNT_KEY_PREFIX_PATTERN;

/// Scans redis for all shas
/// At the time of writing this, there is a bug with scan for redis clusters that
/// causes them to only scan a single node. There is no workaround at this time.
#[tracing::instrument(skip(client))]
pub async fn scan(client: &redis::cluster::ClusterClient) -> anyhow::Result<Vec<String>> {
    let mut redis_connection = client
        .get_async_connection()
        .await
        .context("unable to connect to redis")?;

    let result = redis_connection.keys(SHA_COUNT_KEY_PREFIX_PATTERN).await?;
    Ok(result)
}
