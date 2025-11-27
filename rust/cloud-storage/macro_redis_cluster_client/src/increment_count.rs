use super::{SHA_COUNT_KEY_PREFIX, SHA_DELETE_BUCKET};
use anyhow::Context;
use redis::AsyncCommands;
use tracing::instrument;

#[instrument(skip(client))]
pub(crate) async fn increment_count(
    client: &redis::cluster::ClusterClient,
    sha: &str,
) -> anyhow::Result<()> {
    let mut redis_connection = client
        .get_async_connection()
        .await
        .context("unable to connect to redis")?;

    let key = format!("{}{}", SHA_COUNT_KEY_PREFIX, sha);

    // sets sha key to 0 if it doesn't exist
    redis_connection
        .set_nx::<&str, i32, bool>(key.as_str(), 0)
        .await
        .map_err(anyhow::Error::from)?;

    redis_connection
        .srem::<&str, &str, bool>(SHA_DELETE_BUCKET, sha)
        .await
        .map_err(|e| {
            anyhow::Error::msg(format!("unable to remove sha to delete bucket set {:?}", e))
        })?;

    // increments sha key by 1
    redis_connection
        .incr::<&str, i32, i32>(key.as_str(), 1)
        .await
        .map_err(anyhow::Error::from)?;

    Ok(())
}

#[tracing::instrument(skip(client))]
pub(crate) async fn increment_counts(
    client: &redis::cluster::ClusterClient,
    shas: Vec<String>,
) -> anyhow::Result<()> {
    let mut redis_connection = client
        .get_async_connection()
        .await
        .context("unable to connect to redis")?;

    for sha in shas {
        let key = format!("{}{}", SHA_COUNT_KEY_PREFIX, sha);
        // increments sha key by 1
        redis_connection
            .incr::<&str, i32, i32>(key.as_str(), 1)
            .await
            .map_err(anyhow::Error::from)?;

        // removes the key from the delete bucket in case it is in there
        redis_connection
            .srem::<&str, &str, bool>(SHA_DELETE_BUCKET, sha.as_str())
            .await
            .map_err(anyhow::Error::from)?;
    }

    Ok(())
}

#[cfg(test)]
#[cfg(feature = "redis_cluster_test")]
mod tests {
    use super::*;
    use redis::Commands;

    #[tokio::test]
    async fn test_increment_count() {
        let redis_client = redis::cluster::ClusterClient::new(vec!["redis://localhost:6369"])
            .expect("could not connect to redis client");

        let mut conn = redis_client
            .get_connection()
            .expect("unable to connect to redis");

        // Cleanup from previous test runs
        conn.del::<&str, bool>("sha:test_increment_count_one")
            .unwrap();
        conn.del::<&str, bool>("sha:test_increment_count_two")
            .unwrap();

        let _ = conn.set::<&str, i32, i32>("sha:test_increment_count_two", 2);

        let res = increment_count(&redis_client, &"test_increment_count_one").await;
        assert_eq!(res.is_ok(), true);
        let count: i32 = conn.get("sha:test_increment_count_one").unwrap();
        assert_eq!(count, 1);

        let res = increment_count(&redis_client, &"test_increment_count_two").await;
        assert_eq!(res.is_ok(), true);
        let count: i32 = conn.get("sha:test_increment_count_two").unwrap();
        assert_eq!(count, 3);
    }

    #[tokio::test]
    async fn test_increment_counts() {
        let redis_client = redis::cluster::ClusterClient::new(vec!["redis://localhost:6369"])
            .expect("could not connect to redis client");

        let mut conn = redis_client
            .get_connection()
            .expect("unable to connect to redis");

        // Cleanup from previous test runs
        conn.del::<&str, bool>("sha:test_increment_counts_one")
            .unwrap();
        conn.del::<&str, bool>("sha:test_increment_counts_two")
            .unwrap();

        let _ = conn.set::<&str, i32, i32>("sha:test_increment_counts_two", 2);

        let res = increment_counts(
            &redis_client,
            vec![
                "test_increment_counts_one".to_string(),
                "test_increment_counts_two".to_string(),
            ],
        )
        .await;
        assert_eq!(res.is_ok(), true);
        let mut count: i32 = conn.get("sha:test_increment_counts_one").unwrap();
        assert_eq!(count, 1);
        count = conn.get("sha:test_increment_counts_two").unwrap();
        assert_eq!(count, 3);
    }
}
