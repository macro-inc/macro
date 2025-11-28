use anyhow::Context;
use redis::AsyncCommands;
use tracing::instrument;

#[instrument(skip(client))]
pub(in crate::service::redis) async fn get_set_members(
    client: &redis::cluster::ClusterClient,
    set: &str,
) -> anyhow::Result<Vec<String>> {
    let mut redis_connection = client
        .get_async_connection()
        .await
        .context("unable to connect to redis")?;

    redis_connection
        .smembers::<&str, Vec<String>>(set)
        .await
        .map_err(anyhow::Error::from)
}

#[cfg(feature = "redis_client_test")]
#[cfg(test)]
mod tests {
    use super::*;
    use redis::Commands;

    #[tokio::test]
    #[ignore = "Redis cluster doesn't exist in CI"]
    async fn test_get_set_members() -> Result<(), anyhow::Error> {
        let redis_client = redis::cluster::ClusterClient::new(vec!["redis://localhost:6369"])
            .expect("could not connect to redis client");

        let mut conn = redis_client
            .get_connection()
            .expect("unable to connect to redis");

        conn.del::<&str, bool>("test_get_shas")
            .map_err(|e| anyhow::Error::msg(format!("unable to del {:?}", e)))?;
        conn.sadd::<&str, &str, bool>("test_get_shas", "test_get_shas1")
            .map_err(|e| {
                anyhow::Error::msg(format!("unable to add sha to delete bucket set {:?}", e))
            })?;
        conn.sadd::<&str, &str, bool>("test_get_shas", "test_get_shas2")
            .map_err(|e| {
                anyhow::Error::msg(format!("unable to add sha to delete bucket set {:?}", e))
            })?;
        conn.sadd::<&str, &str, bool>("test_get_shas", "test_get_shas3")
            .map_err(|e| {
                anyhow::Error::msg(format!("unable to add sha to delete bucket set {:?}", e))
            })?;

        let mut res = get_set_members(&redis_client, &"test_get_shas").await?;
        res.sort();

        assert_eq!(
            res,
            vec!["test_get_shas1", "test_get_shas2", "test_get_shas3"]
        );

        Ok(())
    }
}
