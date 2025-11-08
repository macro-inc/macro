use anyhow::Context;
use redis::AsyncCommands;

/// Deletes from redis
pub async fn delete(client: &redis::Client, key: &str) -> anyhow::Result<()> {
    let mut redis_connection = client
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;

    redis_connection
        .del::<&str, ()>(key)
        .await
        .context("unable to delete key")?;

    Ok(())
}

/// Deletes multiple keys from redis
pub async fn delete_multiple(client: &redis::Client, keys: &[&str]) -> anyhow::Result<()> {
    let mut redis_connection = client
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;

    for key in keys {
        redis_connection
            .del::<&str, ()>(key)
            .await
            .with_context(|| format!("unable to delete key {}", key))?;
    }

    Ok(())
}
