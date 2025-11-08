use anyhow::Context;
use redis::AsyncCommands;

/// Sets a value in redis with the expiry
pub async fn set_with_expiry<T>(
    client: &redis::Client,
    key: &str,
    value: T,
    expiry_seconds: u64,
) -> anyhow::Result<()>
where
    T: redis::ToRedisArgs + Send + Sync,
{
    let mut redis_connection = client
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;

    redis_connection
        .set_ex::<&str, T, ()>(key, value, expiry_seconds)
        .await
        .with_context(|| format!("unable to set key {} with expiry", key))?;

    Ok(())
}
