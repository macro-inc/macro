use anyhow::Context;
use redis::AsyncCommands;

/// Gets an optional value from redis
pub async fn get_optional<T>(client: &redis::Client, key: &str) -> anyhow::Result<Option<T>>
where
    T: redis::FromRedisValue,
{
    let mut redis_connection = client
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;

    let value = redis_connection
        .get::<&str, Option<T>>(key)
        .await
        .with_context(|| format!("unable to get value for key {}", key))?;

    Ok(value)
}

/// Gets a value from redis
/// Returns an error if the value is not present
pub async fn get<T>(client: &redis::Client, key: &str) -> anyhow::Result<T>
where
    T: redis::FromRedisValue,
{
    let mut redis_connection = client
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;

    let value = redis_connection
        .get::<&str, T>(key)
        .await
        .with_context(|| format!("unable to get value for key {}", key))?;

    Ok(value)
}

/// Gets multiple values from redis
/// Returns in order of the keys provided
pub async fn get_multiple<T>(
    client: &redis::Client,
    keys: &[String],
) -> anyhow::Result<Vec<Option<T>>>
where
    T: redis::FromRedisValue,
{
    let mut redis_connection = client
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;

    let mut values = vec![];

    for key in keys {
        let value = redis_connection
            .get::<&str, Option<T>>(key)
            .await
            .with_context(|| format!("unable to get value for key {}", key))?;

        values.push(value);
    }

    Ok(values)
}
