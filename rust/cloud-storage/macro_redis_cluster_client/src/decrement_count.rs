use anyhow::Context;
use redis::AsyncCommands;

use super::SHA_COUNT_KEY_PREFIX;

/// Decrements the count of given shas
/// If the count of a sha hits 0 it will also place the sha into a shas-to-delete set
pub(crate) async fn decrement_counts(
    client: &redis::cluster::ClusterClient,
    delete_bucket: &str,
    shas: &Vec<(String, i64)>,
) -> anyhow::Result<()> {
    let mut redis_connection = client
        .get_async_connection()
        .await
        .context("unable to connect to redis")?;

    for (sha, decrement_amount) in shas {
        let key = format!("{}{}", SHA_COUNT_KEY_PREFIX, sha);
        let count = redis_connection
            .get::<&str, i64>(key.as_str())
            .await
            .unwrap_or(0);
        // If the count is 0 (count is actually 0 OR the key doesn't exist)
        // Or if the count - decrement_amount will be lte 0
        // We need to add the sha to the delete bucket
        // and delete the count key
        if count == 0 || count - decrement_amount <= 0 {
            redis_connection
                .del::<&str, bool>(key.as_str())
                .await
                .map_err(|e| anyhow::Error::msg(format!("unable to delete sha count {:?}", e)))?;
            redis_connection
                .sadd::<&str, &str, bool>(delete_bucket, sha)
                .await
                .map_err(|e| {
                    anyhow::Error::msg(format!("unable to add sha to delete bucket set {:?}", e))
                })?;
            continue;
        }

        // decrement sha key
        redis_connection
            .decr::<&str, i64, i64>(key.as_str(), *decrement_amount)
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
    #[ignore = "Redis cluster doesn't exist in CI"]
    async fn test_decrement_counts() {
        let redis_client = redis::cluster::ClusterClient::new(vec!["redis://localhost:6369"])
            .expect("could not connect to redis client");

        let mut conn = redis_client
            .get_connection()
            .expect("unable to connect to redis");

        // Cleanup from previous test runs
        conn.del::<&str, bool>("sha:test_decrement_counts_one")
            .unwrap();
        conn.del::<&str, bool>("sha:test_decrement_counts_two")
            .unwrap();
        conn.del::<&str, bool>("sha:test_decrement_counts_three")
            .unwrap();
        conn.del::<&str, bool>("test_decrement_counts_bucket")
            .unwrap();

        let _ = conn.set::<&str, i32, i32>("sha:test_decrement_counts_one", 2);
        let _ = conn.set::<&str, i32, i32>("sha:test_decrement_counts_two", 1);
        let _ = conn.set::<&str, i32, i32>("sha:test_decrement_counts_three", 3);

        let res = decrement_counts(
            &redis_client,
            "test_decrement_counts_bucket",
            &vec![
                ("test_decrement_counts_one".to_string(), 1),
                ("test_decrement_counts_two".to_string(), 2),
                ("test_decrement_counts_three".to_string(), 3),
            ],
        )
        .await;
        assert_eq!(res.is_ok(), true);
        let count: i32 = conn.get("sha:test_decrement_counts_one").unwrap();
        assert_eq!(count, 1);

        let count: i32 = conn.get("sha:test_decrement_counts_two").unwrap_or(0);
        assert_eq!(count, 0);

        let count: i32 = conn.get("sha:test_decrement_counts_three").unwrap_or(0);
        assert_eq!(count, 0);

        let mut res = conn
            .smembers::<&str, Vec<String>>("test_decrement_counts_bucket")
            .unwrap();

        res.sort();

        assert_eq!(
            res,
            vec!["test_decrement_counts_three", "test_decrement_counts_two"]
        );
    }
}
