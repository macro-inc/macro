use anyhow::Context;
use macro_sha_count_client::SHA_REFERENCE_TTL;

/// Adds `value` to the counter and restarts its expiry in one MULTI/EXEC, so a
/// recounted SHA never leaves a counter without an expiry.
#[tracing::instrument(skip(client))]
pub(in crate::service::redis) async fn increment(
    client: &redis::Client,
    key: &str,
    value: i64,
) -> anyhow::Result<()> {
    let mut redis_connection = client
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;

    redis::pipe()
        .atomic()
        .incr(key, value)
        .ignore()
        .expire(key, SHA_REFERENCE_TTL.as_secs() as i64)
        .ignore()
        .query_async::<()>(&mut redis_connection)
        .await
        .context("unable to set sha count")
}
