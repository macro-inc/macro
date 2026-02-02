use super::*;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_entity::EntityType;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TestNotification {
    message: String,
}

impl Notification for TestNotification {
    const TYPE_NAME: &'static str = "test_notification";

    fn title(&self) -> String {
        "Test".to_string()
    }

    fn body(&self) -> String {
        self.message.clone()
    }

    fn rate_limit_config() -> Option<crate::domain::models::RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<crate::domain::models::RateLimitKey> {
        None
    }
}

fn test_user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("muted_users"))
)]
async fn test_get_muted_users(pool: Pool<Postgres>) {
    let muted = test_user("muted@test.com");
    let not_muted = test_user("other@test.com");

    let result = pool
        .get_muted_users(&[muted.clone(), not_muted])
        .await
        .unwrap();

    assert_eq!(result.len(), 1);
    assert!(result.contains(&muted));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_muted_users_empty(pool: Pool<Postgres>) {
    let user = test_user("nobody@test.com");

    let result = pool.get_muted_users(&[user]).await.unwrap();

    assert!(result.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("unsubscribed_users"))
)]
async fn test_get_unsubscribed_users(pool: Pool<Postgres>) {
    let unsub = test_user("unsub@test.com");
    let other = test_user("other@test.com");

    let result = pool
        .get_unsubscribed_users("item-123", &[unsub.clone(), other])
        .await
        .unwrap();

    assert_eq!(result.len(), 1);
    assert!(result.contains(&unsub));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("unsubscribed_users"))
)]
async fn test_get_unsubscribed_users_different_item(pool: Pool<Postgres>) {
    let unsub = test_user("unsub@test.com");

    let result = pool
        .get_unsubscribed_users("other-item", &[unsub])
        .await
        .unwrap();

    assert!(result.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_devices"))
)]
async fn test_get_device_endpoints(pool: Pool<Postgres>) {
    let user = test_user("user1@test.com");

    let result = pool.get_device_endpoints(&[user.clone()]).await.unwrap();

    let endpoints = result.get(&user).expect("user should have endpoints");
    assert_eq!(endpoints.len(), 2);

    let has_ios = endpoints
        .iter()
        .any(|e| matches!(e, DeviceEndpoint::Ios(_)));
    let has_android = endpoints
        .iter()
        .any(|e| matches!(e, DeviceEndpoint::Android(_)));

    assert!(has_ios, "should have iOS endpoint");
    assert!(has_android, "should have Android endpoint");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_device_endpoints_no_devices(pool: Pool<Postgres>) {
    let user = test_user("nobody@test.com");

    let result = pool.get_device_endpoints(&[user]).await.unwrap();

    assert!(result.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_create_notification(pool: Pool<Postgres>) {
    let recipient = test_user("recipient@test.com");
    let notification_id = uuid::Uuid::new_v4();

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("doc-1"),
        notification: TestNotification {
            message: "hello".to_string(),
        },
        sender_id: None,
        recipient_ids: std::collections::HashSet::from([recipient.clone()]),
    };

    let result = pool
        .create_notification(
            &request,
            notification_id,
            "test_service",
            &[recipient.clone()],
        )
        .await
        .unwrap();

    assert_eq!(result, Some(notification_id));

    // Verify notification was inserted
    let row = sqlx::query!("SELECT id FROM notification WHERE id = $1", notification_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.id, notification_id);

    // Verify user_notification was inserted
    let user_row = sqlx::query!(
        "SELECT user_id FROM user_notification WHERE notification_id = $1",
        notification_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(user_row.user_id, recipient.to_string());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_notifications"))
)]
async fn test_update_sent_status(pool: Pool<Postgres>) {
    let notification_id = uuid::Uuid::parse_str("0193b1ea-a542-7589-893b-2b4a509c1e76").unwrap();
    let user = test_user("user@test.com");

    pool.update_sent_status(notification_id, &[user])
        .await
        .unwrap();

    let row = sqlx::query!(
        "SELECT sent FROM user_notification WHERE notification_id = $1",
        notification_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(row.sent);
}
