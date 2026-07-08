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

/// Atomically gets a value from redis and deletes the key (GETDEL).
/// Returns None if the key did not exist. Unlike a separate get + delete,
/// only one concurrent caller can observe a given value.
pub async fn get_del_optional<T>(client: &redis::Client, key: &str) -> anyhow::Result<Option<T>>
where
    T: redis::FromRedisValue,
{
    let mut redis_connection = client
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;

    let value = redis_connection
        .get_del::<&str, Option<T>>(key)
        .await
        .with_context(|| format!("unable to get and delete value for key {}", key))?;

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
