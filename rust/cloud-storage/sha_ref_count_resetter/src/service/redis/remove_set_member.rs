use anyhow::Context;
use redis::AsyncCommands;

use super::SHA_DELETE_BUCKET;

/// Removes shas from the delete bucket
#[tracing::instrument(skip(client))]
pub(in crate::service::redis) async fn remove_shas_from_delete_bucket(
    client: &redis::cluster::ClusterClient,
    shas: Vec<String>,
) -> anyhow::Result<()> {
    let mut redis_connection = client
        .get_async_connection()
        .await
        .context("unable to connect to redis")?;

    for sha in shas {
        if let Err(e) = redis_connection
            .srem::<&str, &str, bool>(SHA_DELETE_BUCKET, &sha)
            .await
        {
            tracing::error!(error=?e, sha=?sha, "unable to remove from delete bucket");
            return Err(e.into());
        }
    }

    Ok(())
}
