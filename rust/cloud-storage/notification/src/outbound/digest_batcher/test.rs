use super::*;
use crate::domain::models::{Notification, TaggedContent};
use model_entity::EntityType;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TestNotification {
    message: String,
}

impl Notification for TestNotification {
    const TYPE_NAME: &'static str = "test_notification";
}

async fn get_redis_connection() -> MultiplexedConnection {
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
    let client = redis::Client::open(redis_url).expect("Failed to create Redis client");
    client
        .get_multiplexed_async_connection()
        .await
        .expect("Failed to connect to Redis")
}

/// Each test gets a unique key prefix so tests can run in parallel across
/// nextest processes without interfering with each other's Redis state.
fn test_prefix(name: &str) -> String {
    format!("test_{name}_{}", Uuid::new_v4().as_simple())
}

async fn cleanup_prefix(conn: &mut MultiplexedConnection, prefix: &str) {
    let keys: Vec<String> = redis::cmd("KEYS")
        .arg(format!("{prefix}:*"))
        .query_async(conn)
        .await
        .unwrap_or_default();

    for key in keys {
        conn.del::<_, ()>(&key).await.unwrap();
    }
}

fn test_user(suffix: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|test_{}@example.com", suffix)).unwrap()
}

fn create_test_notification(
    user_id: MacroUserIdStr<'static>,
    message: &str,
) -> UserNotificationRow<serde_json::Value> {
    let notification = TestNotification {
        message: message.to_string(),
    };

    UserNotificationRow {
        owner_id: user_id,
        notification_id: Uuid::new_v4(),
        notification_event_type: TestNotification::TYPE_NAME.to_string(),
        entity: EntityType::Document.with_entity_string(Uuid::new_v4().to_string()),
        sent: false,
        done: false,
        created_at: Some(Utc::now()),
        viewed_at: None,
        updated_at: Some(Utc::now()),
        deleted_at: None,
        notification_metadata: serde_json::to_value(TaggedContent::new(notification))
            .expect("serialize cannot fail"),
        sender_id: None,
    }
}

/// Creates a notification with raw metadata (no TaggedContent wrapper),
/// matching how production code stores via `inner_store_batch` and `mark_message_as_failed`.
fn create_raw_test_notification(
    user_id: MacroUserIdStr<'static>,
    message: &str,
) -> UserNotificationRow<serde_json::Value> {
    let notification = TestNotification {
        message: message.to_string(),
    };

    UserNotificationRow {
        owner_id: user_id,
        notification_id: Uuid::new_v4(),
        notification_event_type: TestNotification::TYPE_NAME.to_string(),
        entity: EntityType::Document.with_entity_string(Uuid::new_v4().to_string()),
        sent: false,
        done: false,
        created_at: Some(Utc::now()),
        viewed_at: None,
        updated_at: Some(Utc::now()),
        deleted_at: None,
        notification_metadata: serde_json::to_value(notification).expect("serialize cannot fail"),
        sender_id: None,
    }
}

#[tokio::test]
async fn test_add_to_digest_creates_pending_entry() {
    let mut conn = get_redis_connection().await;
    let prefix = test_prefix("add_creates_entry");
    let batcher = RedisDigestBatcher::with_key_prefix(conn.clone(), &prefix);
    let user = test_user("add_creates_entry");
    let notification = create_test_notification(user.clone(), "test message");

    batcher
        .add_to_digest(&notification, Duration::from_secs(60))
        .await
        .expect("Failed to add to digest");

    // Verify the notification was added to the list
    let digest_key = format!("{prefix}:digest:{}", user.as_ref());
    let items: Vec<String> = conn.lrange(&digest_key, 0, -1).await.unwrap();
    assert_eq!(items.len(), 1);

    // Verify user was added to pending set
    let pending_key = format!("{prefix}:digest_pending_users");
    let score: Option<f64> = conn.zscore(&pending_key, user.as_ref()).await.unwrap();
    assert!(score.is_some());

    cleanup_prefix(&mut conn, &prefix).await;
}

#[tokio::test]
async fn test_add_multiple_notifications_same_user() {
    let mut conn = get_redis_connection().await;
    let prefix = test_prefix("multiple_same_user");
    let batcher = RedisDigestBatcher::with_key_prefix(conn.clone(), &prefix);
    let user = test_user("multiple_same_user");

    let notif1 = create_test_notification(user.clone(), "message 1");
    let notif2 = create_test_notification(user.clone(), "message 2");
    let notif3 = create_test_notification(user.clone(), "message 3");

    batcher
        .add_to_digest(&notif1, Duration::from_secs(60))
        .await
        .unwrap();
    batcher
        .add_to_digest(&notif2, Duration::from_secs(60))
        .await
        .unwrap();
    batcher
        .add_to_digest(&notif3, Duration::from_secs(60))
        .await
        .unwrap();

    // Verify all notifications were added
    let digest_key = format!("{prefix}:digest:{}", user.as_ref());
    let items: Vec<String> = conn.lrange(&digest_key, 0, -1).await.unwrap();
    assert_eq!(items.len(), 3);

    // Verify user appears only once in pending set (NX semantics)
    let pending_key = format!("{prefix}:digest_pending_users");
    let count: usize = conn.zcard(&pending_key).await.unwrap();
    assert_eq!(count, 1);

    cleanup_prefix(&mut conn, &prefix).await;
}

#[tokio::test]
async fn test_claim_ready_digest_returns_empty_when_none_pending() {
    let conn = get_redis_connection().await;
    let prefix = test_prefix("empty_when_none");
    let batcher = RedisDigestBatcher::with_key_prefix(conn.clone(), &prefix);

    let result = batcher.claim_ready_digest().await.unwrap();
    assert!(matches!(result, ClaimResult::Empty));
}

#[tokio::test]
async fn test_claim_ready_digest_returns_wait_when_not_ready() {
    let mut conn = get_redis_connection().await;
    let prefix = test_prefix("wait_not_ready");
    let batcher = RedisDigestBatcher::with_key_prefix(conn.clone(), &prefix);
    let user = test_user("not_ready");
    let notification = create_test_notification(user.clone(), "test");

    // Add with 60 second delay
    batcher
        .add_to_digest(&notification, Duration::from_secs(60))
        .await
        .unwrap();

    let result = batcher.claim_ready_digest().await.unwrap();

    match result {
        ClaimResult::Wait(duration) => {
            // Should be close to 60 seconds (allow some margin)
            assert!(duration.as_secs() >= 58 && duration.as_secs() <= 60);
        }
        other => panic!("Expected ClaimResult::Wait, got {:?}", other),
    }

    cleanup_prefix(&mut conn, &prefix).await;
}

#[tokio::test]
async fn test_claim_ready_digest_returns_batch_when_ready() {
    let mut conn = get_redis_connection().await;
    let prefix = test_prefix("batch_when_ready");
    let batcher = RedisDigestBatcher::with_key_prefix(conn.clone(), &prefix);
    let user = test_user("ready_batch");
    let notification = create_test_notification(user.clone(), "ready message");

    // Add with 0 second delay (immediately ready)
    batcher
        .add_to_digest(&notification, Duration::from_secs(0))
        .await
        .unwrap();

    // Small delay to ensure the timestamp is in the past
    tokio::time::sleep(Duration::from_millis(100)).await;

    let result = batcher.claim_ready_digest().await.unwrap();

    match result {
        ClaimResult::Ready(batch) => {
            assert_eq!(batch.user_id.as_ref(), user.as_ref());
            assert_eq!(batch.notifications.len(), 1);
        }
        other => panic!("Expected ClaimResult::Ready, got {:?}", other),
    }

    // Verify the digest was cleaned up
    let digest_key = format!("{prefix}:digest:{}", user.as_ref());
    let items: Vec<String> = conn.lrange(&digest_key, 0, -1).await.unwrap();
    assert!(items.is_empty());

    // Verify user was removed from pending set
    let pending_key = format!("{prefix}:digest_pending_users");
    let score: Option<f64> = conn.zscore(&pending_key, user.as_ref()).await.unwrap();
    assert!(score.is_none());

    cleanup_prefix(&mut conn, &prefix).await;
}

#[tokio::test]
async fn test_new_notifications_during_processing_not_lost() {
    let mut conn = get_redis_connection().await;
    let prefix = test_prefix("during_processing");
    let batcher = RedisDigestBatcher::with_key_prefix(conn.clone(), &prefix);
    let user = test_user("during_processing");

    // Add first notification (immediately ready)
    let notif1 = create_test_notification(user.clone(), "first");
    batcher
        .add_to_digest(&notif1, Duration::from_secs(0))
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(100)).await;

    // Claim the digest
    let result = batcher.claim_ready_digest().await.unwrap();
    assert!(matches!(result, ClaimResult::Ready(_)));

    // Add another notification after the claim (simulating concurrent add)
    let notif2 = create_test_notification(user.clone(), "second");
    batcher
        .add_to_digest(&notif2, Duration::from_secs(0))
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(100)).await;

    // The second notification should be in a new batch
    let result2 = batcher.claim_ready_digest().await.unwrap();
    match result2 {
        ClaimResult::Ready(batch) => {
            assert_eq!(batch.notifications.len(), 1);
        }
        other => panic!("Expected second batch to be ready, got {:?}", other),
    }

    cleanup_prefix(&mut conn, &prefix).await;
}

#[tokio::test]
async fn test_claim_digest_tags_raw_metadata() {
    let mut conn = get_redis_connection().await;
    let prefix = test_prefix("tags_raw_metadata");
    let batcher = RedisDigestBatcher::with_key_prefix(conn.clone(), &prefix);
    let user = test_user("tags_raw");

    // Store with raw metadata (no TaggedContent wrapper), matching production code paths
    let notification = create_raw_test_notification(user.clone(), "raw message");
    let expected_id = notification.notification_id;

    batcher
        .add_to_digest(&notification, Duration::from_secs(0))
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(100)).await;

    let result = batcher.claim_ready_digest().await.unwrap();

    match result {
        ClaimResult::Ready(batch) => {
            assert_eq!(batch.user_id.as_ref(), user.as_ref());
            assert_eq!(
                batch.notifications.len(),
                1,
                "notification must not be silently dropped"
            );
            let tagged = &batch.notifications[0];
            assert_eq!(tagged.notification_id, expected_id);
            // Verify the metadata was wrapped in TaggedContent by round-tripping
            // back to JSON and checking for the { "tag": ..., "content": ... } shape
            let meta_json = serde_json::to_value(&tagged.notification_metadata).unwrap();
            assert_eq!(meta_json["tag"], TestNotification::TYPE_NAME);
            assert_eq!(meta_json["content"]["message"], "raw message");
        }
        other => panic!("Expected ClaimResult::Ready, got {:?}", other),
    }

    cleanup_prefix(&mut conn, &prefix).await;
}

#[tokio::test]
async fn test_multiple_users_independent() {
    let mut conn = get_redis_connection().await;
    let prefix = test_prefix("multi_user");
    let batcher = RedisDigestBatcher::with_key_prefix(conn.clone(), &prefix);

    let user1 = test_user("multi_user_1");
    let user2 = test_user("multi_user_2");

    let notif1 = create_test_notification(user1.clone(), "user1 message");
    let notif2 = create_test_notification(user2.clone(), "user2 message");

    // Add notifications for both users
    batcher
        .add_to_digest(&notif1, Duration::from_secs(0))
        .await
        .unwrap();
    batcher
        .add_to_digest(&notif2, Duration::from_secs(0))
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(100)).await;

    // Claim both batches
    let result1 = batcher.claim_ready_digest().await.unwrap();
    let result2 = batcher.claim_ready_digest().await.unwrap();

    assert!(matches!(result1, ClaimResult::Ready(_)));
    assert!(matches!(result2, ClaimResult::Ready(_)));

    // Third claim should be empty
    let result3 = batcher.claim_ready_digest().await.unwrap();
    assert!(matches!(result3, ClaimResult::Empty));

    cleanup_prefix(&mut conn, &prefix).await;
}
