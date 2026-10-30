use super::{SHA_COUNT_KEY_PREFIX, SHA_DELETE_BUCKET, SHA_REFERENCE_TTL};
use anyhow::Context;

/// Adds one reference to each SHA, restarts its expiry, and takes it out of
/// the delete bucket, all in one MULTI/EXEC so a counter never exists without
/// an expiry.
#[tracing::instrument(skip_all, fields(sha_count = shas.len()), err)]
pub(crate) async fn increment_counts(
    client: &redis::Client,
    shas: Vec<String>,
) -> anyhow::Result<()> {
    if shas.is_empty() {
        return Ok(());
    }
    let mut redis_connection = client
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;

    let mut pipeline = redis::pipe();
    pipeline.atomic();
    for sha in &shas {
        let key = format!("{SHA_COUNT_KEY_PREFIX}{sha}");
        pipeline
            .incr(&key, 1)
            .ignore()
            .expire(&key, SHA_REFERENCE_TTL.as_secs() as i64)
            .ignore()
            .srem(SHA_DELETE_BUCKET, sha)
            .ignore();
    }
    pipeline
        .query_async::<()>(&mut redis_connection)
        .await
        .context("unable to increment sha counts")
}

#[cfg(test)]
#[cfg(feature = "redis_test")]
mod tests {
    use super::*;
    use redis::Commands;

    #[tokio::test]
    #[ignore = "Redis doesn't exist in CI"]
    async fn test_increment_counts() {
        let redis_client = redis::Client::open("redis://localhost:6379")
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
