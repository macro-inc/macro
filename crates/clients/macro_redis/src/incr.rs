use anyhow::Context;

/// Increments a value in redis with the expiry
pub async fn incr_with_expiry(
    client: &redis::Client,
    key: &str,
    expiry_seconds: i64,
) -> anyhow::Result<()> {
    let mut redis_connection = client
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;

    redis::pipe()
        .atomic()
        .incr(key, 1)
        .expire(key, expiry_seconds)
        .exec_async(&mut redis_connection)
        .await
        .with_context(|| format!("failed to increment and set expiry for key {}", key))?;

    Ok(())
}

/// Increments multiple values in redis with the provided expiry
pub async fn incr_with_expiry_bulk(
    client: &redis::Client,
    keys: &[String],
    expiry_seconds: i64,
) -> anyhow::Result<()> {
    let mut redis_connection = client
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;

    for key in keys {
        redis::pipe()
            .atomic()
            .incr(key, 1)
            .expire(key, expiry_seconds)
            .exec_async(&mut redis_connection)
            .await
            .with_context(|| format!("failed to increment and set expiry for key {}", key))?;
    }

    Ok(())
}
