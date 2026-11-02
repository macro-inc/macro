use super::*;

fn client() -> RedisClient {
    RedisClient::new(redis::Client::open("redis://127.0.0.1:6379/").unwrap(), 60)
}

/// A slot set of its own, so tests never touch the fleet's slots or each other's.
fn unique_key() -> String {
    format!("test:email:backfill:write_slots:{}", Uuid::now_v7())
}

fn slots(key: &str, capacity: u32) -> SlotSet<'_> {
    SlotSet {
        key,
        capacity,
        lease: LEASE,
        wait: Duration::ZERO,
    }
}

async fn cleanup(client: &RedisClient, key: &str) {
    let mut connection = client
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let _: i32 = redis::cmd("DEL")
        .arg(key)
        .query_async(&mut connection)
        .await
        .unwrap();
}

#[tokio::test]
async fn writes_beyond_capacity_are_refused_until_a_slot_is_released() {
    let client = client();
    let key = unique_key();
    let slots = slots(&key, 2);

    let first = client
        .acquire_write_slot(&slots)
        .await
        .unwrap()
        .expect("the first write gets a slot");
    let second = client
        .acquire_write_slot(&slots)
        .await
        .unwrap()
        .expect("the second write gets a slot");
    assert!(
        client.acquire_write_slot(&slots).await.unwrap().is_none(),
        "a third concurrent write must wait"
    );

    first.release().await;
    let third = client
        .acquire_write_slot(&slots)
        .await
        .unwrap()
        .expect("a released slot admits the next write");

    second.release().await;
    third.release().await;
    cleanup(&client, &key).await;
}

#[tokio::test]
async fn a_crashed_writers_expired_lease_frees_its_slot() {
    let client = client();
    let key = unique_key();
    let mut connection = client
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    // A lease that expired long ago, as left by a worker that died holding it.
    let _: i32 = redis::cmd("ZADD")
        .arg(&key)
        .arg(1)
        .arg("crashed-writer")
        .query_async(&mut connection)
        .await
        .unwrap();

    let slot = client
        .acquire_write_slot(&slots(&key, 1))
        .await
        .unwrap()
        .expect("an expired lease does not hold the only slot");

    slot.release().await;
    cleanup(&client, &key).await;
}

fn lease_id(slot: &BackfillWriteSlot) -> String {
    slot.inner.as_ref().expect("a held slot").id.clone()
}

#[tokio::test]
async fn renewing_a_held_slot_pushes_its_lease_forward() {
    let client = client();
    let key = unique_key();
    let slot = client
        .acquire_write_slot(&slots(&key, 1))
        .await
        .unwrap()
        .expect("the only slot is free");
    let id = lease_id(&slot);
    let mut connection = client
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    // A lease about to expire, as after a long write.
    let _: i32 = redis::cmd("ZADD")
        .arg(&key)
        .arg("XX")
        .arg(1)
        .arg(&id)
        .query_async(&mut connection)
        .await
        .unwrap();

    let renewed = slot.inner.as_ref().unwrap().renew().await.unwrap();

    let expires_at: f64 = redis::cmd("ZSCORE")
        .arg(&key)
        .arg(&id)
        .query_async(&mut connection)
        .await
        .unwrap();
    assert!(renewed);
    assert!(
        expires_at > 1.0e12,
        "the lease now ends at a real time ahead of now"
    );
    slot.release().await;
    cleanup(&client, &key).await;
}

#[tokio::test]
async fn an_expired_lease_is_not_renewed_back_into_a_full_set() {
    let client = client();
    let key = unique_key();
    let slot = client
        .acquire_write_slot(&slots(&key, 1))
        .await
        .unwrap()
        .expect("the only slot is free");
    let mut connection = client
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    // The lease expired and another writer took the slot.
    let _: i32 = redis::cmd("ZREM")
        .arg(&key)
        .arg(lease_id(&slot))
        .query_async(&mut connection)
        .await
        .unwrap();
    let other = client
        .acquire_write_slot(&slots(&key, 1))
        .await
        .unwrap()
        .expect("the expired slot is free again");

    let renewed = slot.inner.as_ref().unwrap().renew().await.unwrap();

    let held: i32 = redis::cmd("ZCARD")
        .arg(&key)
        .query_async(&mut connection)
        .await
        .unwrap();
    assert!(!renewed);
    assert_eq!(held, 1, "only the new writer holds the slot");
    other.release().await;
    cleanup(&client, &key).await;
}
