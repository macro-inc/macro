use super::*;

macro_env_var::maybe_env_var! {
    struct RedisUrl;
}

fn client() -> RedisClient {
    let redis_url = RedisUrl::new();
    let url = redis_url
        .as_ref()
        .and_then(RedisUrl::value)
        .unwrap_or("redis://127.0.0.1:6379");
    RedisClient::new(redis::Client::open(url).unwrap(), 0, 0, 0)
}

fn unique_key() -> String {
    format!("test_lock:{}", Uuid::now_v7())
}

async fn ttl_seconds(client: &RedisClient, key: &str) -> i64 {
    let mut con = client
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    redis::cmd("TTL")
        .arg(key)
        .query_async(&mut con)
        .await
        .unwrap()
}

#[tokio::test]
async fn second_claim_is_rejected_while_the_lock_is_held() {
    let client = client();
    let key = unique_key();

    let lock = client
        .try_acquire_lock(&key, Duration::from_secs(60))
        .await
        .unwrap();

    assert!(matches!(
        client.try_acquire_lock(&key, Duration::from_secs(60)).await,
        Err(LockError::AlreadyHeld)
    ));

    lock.release().await;
    client
        .try_acquire_lock(&key, Duration::from_secs(60))
        .await
        .expect("released lock can be claimed again")
        .release()
        .await;
}

#[tokio::test]
async fn extend_resets_the_ttl_of_a_held_lock() {
    let client = client();
    let key = unique_key();
    let lock = client
        .try_acquire_lock(&key, Duration::from_secs(5))
        .await
        .unwrap();

    assert!(lock.extend(Duration::from_secs(600)).await.unwrap());
    assert!(ttl_seconds(&client, &key).await > 5);

    lock.release().await;
}

#[tokio::test]
async fn extend_does_not_take_over_a_lock_claimed_by_someone_else() {
    let client = client();
    let key = unique_key();
    let lapsed = client
        .try_acquire_lock(&key, Duration::from_secs(60))
        .await
        .unwrap();

    let mut con = client
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let _: () = redis::cmd("SET")
        .arg(&key)
        .arg("other-owner")
        .arg("EX")
        .arg(5)
        .query_async(&mut con)
        .await
        .unwrap();

    assert!(!lapsed.extend(Duration::from_secs(600)).await.unwrap());
    assert!(ttl_seconds(&client, &key).await <= 5);

    lapsed.release().await;
    let owner: Option<String> = redis::cmd("GET")
        .arg(&key)
        .query_async(&mut con)
        .await
        .unwrap();
    assert_eq!(owner.as_deref(), Some("other-owner"));
}
