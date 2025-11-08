use anyhow::Context;
use redis::AsyncCommands;

/// Increments the value of a key by the given amount
#[tracing::instrument(skip(client))]
pub(in crate::service::redis) async fn increment(
    client: &redis::cluster::ClusterClient,
    key: &str,
    value: i64,
) -> anyhow::Result<()> {
    let mut redis_connection = client
        .get_async_connection()
        .await
        .context("unable to connect to redis")?;

    // Set the key if it doesn't exist
    redis_connection
        .set_nx::<&str, i32, bool>(key, 0)
        .await
        .map_err(anyhow::Error::from)?;

    // increments sha key by 1
    redis_connection
        .incr::<&str, i64, i32>(key, value)
        .await
        .map_err(anyhow::Error::from)?;

    Ok(())
}
