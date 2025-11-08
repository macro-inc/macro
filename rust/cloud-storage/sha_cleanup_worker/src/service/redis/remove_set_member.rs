use anyhow::Context;
use redis::AsyncCommands;
use tracing::instrument;

#[instrument(skip(client, set, key))]
pub(in crate::service::redis) async fn remove_set_member(
    client: &redis::cluster::ClusterClient,
    set: &str,
    key: &str,
) -> Result<(), anyhow::Error> {
    let mut redis_connection = client
        .get_async_connection()
        .await
        .context("unable to connect to redis")?;

    redis_connection
        .srem::<&str, &str, bool>(set, key)
        .await
        .map_err(|e| {
            tracing::error!("unable to remove key from set");
            anyhow::Error::from(e)
        })?;

    Ok(())
}

#[instrument(skip(client, set, keys))]
pub(in crate::service::redis) async fn remove_set_members(
    client: &redis::cluster::ClusterClient,
    set: &str,
    keys: Vec<String>,
) -> Result<(), anyhow::Error> {
    let mut redis_connection = client
        .get_async_connection()
        .await
        .context("unable to connect to redis")?;

    redis_connection
        .srem::<&str, Vec<String>, bool>(set, keys)
        .await
        .map_err(|e| {
            tracing::error!("unable to remove keys from set");
            anyhow::Error::from(e)
        })?;

    Ok(())
}

#[cfg(feature = "redis_client_test")]
#[cfg(test)]
mod tests {
    use super::*;
    use redis::Commands;

    #[tokio::test]
    async fn test_remove_set_member() -> Result<(), anyhow::Error> {
        let redis_client = redis::cluster::ClusterClient::new(vec!["redis://localhost:6369"])
            .expect("could not connect to redis client");

        let mut conn = redis_client
            .get_connection()
            .expect("unable to connect to redis");

        let set_key = "test_remove_set_member";
        conn.del::<&str, bool>(set_key)
            .map_err(|e| anyhow::Error::msg(format!("unable to del {:?}", e)))?;
        conn.sadd::<&str, &str, bool>(set_key, "test_get_shas1")
            .map_err(|e| {
                anyhow::Error::msg(format!("unable to add sha to delete bucket set {:?}", e))
            })?;
        conn.sadd::<&str, &str, bool>(set_key, "test_get_shas2")
            .map_err(|e| {
                anyhow::Error::msg(format!("unable to add sha to delete bucket set {:?}", e))
            })?;
        conn.sadd::<&str, &str, bool>(set_key, "test_get_shas3")
            .map_err(|e| {
                anyhow::Error::msg(format!("unable to add sha to delete bucket set {:?}", e))
            })?;

        let res = remove_set_member(&redis_client, set_key, &"test_get_shas3").await;
        assert_eq!(res.is_ok(), true);
        let res = remove_set_member(&redis_client, set_key, &"test_get_shas2").await;
        assert_eq!(res.is_ok(), true);
        let res = conn
            .smembers::<&str, Vec<String>>(set_key)
            .map_err(|e| anyhow::Error::from(e))?;
        assert_eq!(vec!["test_get_shas1"], res);

        Ok(())
    }

    #[tokio::test]
    async fn test_remove_set_members() -> Result<(), anyhow::Error> {
        let redis_client = redis::cluster::ClusterClient::new(vec!["redis://localhost:6369"])
            .expect("could not connect to redis client");

        let mut conn = redis_client
            .get_connection()
            .expect("unable to connect to redis");

        let set_key = "test_remove_set_members";
        conn.del::<&str, bool>(set_key)
            .map_err(|e| anyhow::Error::msg(format!("unable to del {:?}", e)))?;
        conn.sadd::<&str, &str, bool>(set_key, "test_get_shas1")
            .map_err(|e| {
                anyhow::Error::msg(format!("unable to add sha to delete bucket set {:?}", e))
            })?;
        conn.sadd::<&str, &str, bool>(set_key, "test_get_shas2")
            .map_err(|e| {
                anyhow::Error::msg(format!("unable to add sha to delete bucket set {:?}", e))
            })?;
        conn.sadd::<&str, &str, bool>(set_key, "test_get_shas3")
            .map_err(|e| {
                anyhow::Error::msg(format!("unable to add sha to delete bucket set {:?}", e))
            })?;

        remove_set_members(
            &redis_client,
            set_key,
            vec!["test_get_shas3".to_string(), "test_get_shas2".to_string()],
        )
        .await?;
        let res = conn
            .smembers::<&str, Vec<String>>(set_key)
            .map_err(|e| anyhow::Error::from(e))?;
        assert_eq!(vec!["test_get_shas1"], res);

        Ok(())
    }
}
