use anyhow::Context;
use redis::AsyncCommands;

use super::SHA_COUNT_KEY_PREFIX;

/// Sets shas ref count in redis
#[tracing::instrument(skip(client, items))]
pub(in crate::service::redis) async fn set_shas(
    client: &redis::cluster::ClusterClient,
    items: Vec<(String, i64)>,
) -> anyhow::Result<()> {
    let mut redis_connection = client
        .get_async_connection()
        .await
        .context("unable to connect to redis")?;

    for (key, value) in items {
        if let Err(e) = redis_connection
            .set::<&str, i64, bool>(format!("{}{}", SHA_COUNT_KEY_PREFIX, key).as_str(), value)
            .await
        {
            tracing::error!(error=?e, key=?key, value=?value, "unable to set");
            return Err(e.into());
        }
    }

    Ok(())
}
