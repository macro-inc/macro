use super::reference_counts;

#[test]
fn each_listing_of_a_sha_is_one_reference() {
    let shas = ["b", "a", "b", "c", "b"].map(String::from).to_vec();
    assert_eq!(
        reference_counts(shas),
        vec![("a".into(), 1), ("b".into(), 3), ("c".into(), 1)]
    );
}

#[test]
fn no_shas_release_nothing() {
    assert!(reference_counts(Vec::new()).is_empty());
}

#[tokio::test]
async fn an_increment_restarts_the_counter_expiry() -> anyhow::Result<()> {
    use redis::AsyncCommands;

    let url = macro_env_var::optional_read_env_var("REDIS_URI")?
        .unwrap_or_else(|| "redis://127.0.0.1:6379".to_owned());
    let client = redis::Client::open(url)?;
    let mut connection = client.get_multiplexed_async_connection().await?;
    let sha = "an_increment_restarts_the_counter_expiry";
    let key = format!("sha:{sha}");
    connection.set_ex::<_, _, ()>(&key, 2, 60).await?;
    connection
        .sadd::<_, _, ()>("bucket:sha-delete", sha)
        .await?;

    super::Redis::new(client)
        .increment_counts(vec![sha.to_owned()])
        .await?;

    let count: i64 = connection.get(&key).await?;
    let ttl: i64 = connection.ttl(&key).await?;
    let queued: bool = connection.sismember("bucket:sha-delete", sha).await?;
    connection.del::<_, ()>(&key).await?;
    assert_eq!(count, 3);
    assert!(ttl > 60 && ttl <= super::SHA_REFERENCE_TTL.as_secs() as i64);
    assert!(!queued);
    Ok(())
}
