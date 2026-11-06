use attention_feed::test_support::uuid;

use super::*;

macro_env_var::maybe_env_var! {
    struct RedisUrl;
}

async fn log() -> RedisClearLog {
    let redis_url = RedisUrl::new();
    let url = redis_url
        .as_ref()
        .and_then(RedisUrl::value)
        .unwrap_or("redis://127.0.0.1:6379");
    let client = redis::Client::open(url).unwrap();
    RedisClearLog::new(client.get_multiplexed_async_connection().await.unwrap())
}

fn viewer() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap()
}

fn receipt(key: &str, notification: u128) -> DoneReceipt {
    DoneReceipt {
        keys: vec![key.to_string()],
        notification_ids: vec![uuid(notification)],
        unseen_ids: vec![uuid(notification)],
        ..Default::default()
    }
}

#[tokio::test]
async fn a_clear_is_recorded_stopped_and_taken_once() {
    let log = log().await;
    let user = viewer();
    let id = Uuid::now_v7();
    assert_eq!(log.progress(&user, id).await.unwrap(), None);

    log.begin(&user, id).await.unwrap();
    assert!(
        !log.record(&user, id, 2, &receipt("document:a", 1))
            .await
            .unwrap()
    );
    // A batch that cleared nothing adds no receipt.
    assert!(
        !log.record(&user, id, 0, &DoneReceipt::default())
            .await
            .unwrap()
    );
    log.cancel(&user, id).await.unwrap();
    assert!(
        log.record(&user, id, 1, &receipt("document:b", 2))
            .await
            .unwrap()
    );
    log.finish(&user, id).await.unwrap();
    assert_eq!(
        log.progress(&user, id).await.unwrap(),
        Some(ClearProgress {
            rows: 3,
            finished: true
        })
    );

    let taken = log.take(&user, id).await.unwrap();
    assert_eq!(
        taken,
        vec![receipt("document:a", 1), receipt("document:b", 2)]
    );
    assert!(log.take(&user, id).await.unwrap().is_empty());
    assert_eq!(log.progress(&user, id).await.unwrap(), None);
}

#[tokio::test]
async fn cancelling_an_unknown_clear_leaves_nothing_behind() {
    let log = log().await;
    let user = viewer();
    let id = Uuid::now_v7();
    log.cancel(&user, id).await.unwrap();
    assert_eq!(log.progress(&user, id).await.unwrap(), None);
}

#[tokio::test]
async fn a_clear_whose_log_was_taken_stops_and_records_nothing() {
    let log = log().await;
    let user = viewer();
    let id = Uuid::now_v7();
    log.begin(&user, id).await.unwrap();
    log.take(&user, id).await.unwrap();

    assert!(
        log.record(&user, id, 1, &receipt("document:a", 1))
            .await
            .unwrap()
    );
    assert_eq!(log.progress(&user, id).await.unwrap(), None);
    assert!(log.take(&user, id).await.unwrap().is_empty());
}
