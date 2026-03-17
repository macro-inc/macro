use crate::domain::models::Notification;

use super::*;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_entity::EntityType;
use models_pagination::CreatedAt;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TestNotification {
    message: String,
}

impl Notification for TestNotification {
    const TYPE_NAME: &'static str = "test_notification";
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

    let result = pool
        .get_device_endpoints(std::slice::from_ref(&user))
        .await
        .unwrap();

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
        notification: TaggedContent::new(TestNotification {
            message: "hello".to_string(),
        }),
        sender_id: None,
        recipient_ids: std::collections::HashSet::from([recipient.clone()]),
    };

    let result = pool
        .create_notification(request, notification_id, "test_service", None)
        .await
        .unwrap();

    assert!(result.is_some());

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

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("notifications_with_collapse_keys")
    )
)]
async fn test_mark_notifications_seen(pool: Pool<Postgres>) {
    let user = test_user("user@test.com");
    let notification_id = uuid::Uuid::parse_str("0193b1ea-a542-7589-893b-2b4a509c1e76").unwrap();

    pool.mark_notifications_seen(&user, &[notification_id])
        .await
        .unwrap();

    let row = sqlx::query!(
        "SELECT seen_at FROM user_notification WHERE notification_id = $1 AND user_id = $2",
        notification_id,
        user.to_string()
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(row.seen_at.is_some());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("notifications_with_collapse_keys")
    )
)]
async fn test_mark_notifications_seen_does_not_affect_other_users(pool: Pool<Postgres>) {
    let user = test_user("user@test.com");
    let other_user = test_user("other@test.com");
    let notification_id = uuid::Uuid::parse_str("0193b1ea-a542-7589-893b-2b4a509c1e76").unwrap();

    // Insert a user_notification for the other user
    sqlx::query!(
        "INSERT INTO user_notification (user_id, notification_id, created_at) VALUES ($1, $2, '2025-01-01 00:00:00')",
        other_user.to_string(),
        notification_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    // Mark seen only for the first user
    pool.mark_notifications_seen(&user, &[notification_id])
        .await
        .unwrap();

    // Other user's notification should still be unseen
    let row = sqlx::query!(
        "SELECT seen_at FROM user_notification WHERE notification_id = $1 AND user_id = $2",
        notification_id,
        other_user.to_string()
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(row.seen_at.is_none());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("notifications_with_collapse_keys")
    )
)]
async fn test_get_basic_notifications(pool: Pool<Postgres>) {
    let with_key = uuid::Uuid::parse_str("0193b1ea-a542-7589-893b-2b4a509c1e76").unwrap();
    let without_key = uuid::Uuid::parse_str("0193b1ea-b642-7589-893b-2b4a509c1e76").unwrap();

    let result = pool
        .get_basic_notifications(&[with_key, without_key])
        .await
        .unwrap();

    // Only the notification with a collapse key should be returned
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].id, with_key);
    assert_eq!(result[0].apns_collapse_key, "collapse-key-1");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_basic_notifications_empty(pool: Pool<Postgres>) {
    let id = uuid::Uuid::new_v4();

    let result = pool.get_basic_notifications(&[id]).await.unwrap();

    assert!(result.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_notifications"))
)]
async fn test_get_user_notifications(pool: Pool<Postgres>) {
    let result: Vec<UserNotificationRow<TestNotification>> = pool
        .get_user_notifications(
            MacroUserIdStr::parse_from_str("macro|user@test.com").unwrap(),
            10,
            Query::Sort(CreatedAt, ()),
        )
        .await
        .unwrap();

    assert_eq!(result.len(), 1);
    let row = &result[0];
    assert_eq!(
        row.owner_id,
        MacroUserIdStr::parse_from_str("macro|user@test.com").unwrap()
    );
    assert_eq!(
        row.notification_id,
        uuid::Uuid::parse_str("0193b1ea-a542-7589-893b-2b4a509c1e76").unwrap()
    );
    assert_eq!(row.entity.entity_type, EntityType::Document);
    assert!(!row.sent);
    assert!(!row.done);
    assert_eq!(row.notification_metadata.message, "hello");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_notifications_with_invalid"))
)]
async fn test_get_user_notifications_skips_invalid_entity_type(pool: Pool<Postgres>) {
    let result: Vec<UserNotificationRow<TestNotification>> = pool
        .get_user_notifications(
            MacroUserIdStr::parse_from_str("macro|user@test.com").unwrap(),
            10,
            Query::Sort(CreatedAt, ()),
        )
        .await
        .unwrap();

    // 3 notifications inserted, but only the valid one (with entity_type "document"
    // and correct metadata) should survive. The one with "bogus_entity" and the one
    // with non-matching metadata are silently filtered out.
    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0].notification_id,
        uuid::Uuid::parse_str("0193b1ea-a542-7589-893b-2b4a509c1e76").unwrap()
    );
    assert_eq!(result[0].entity.entity_type, EntityType::Document);
    assert_eq!(result[0].notification_metadata.message, "hello");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_notifications_with_invalid"))
)]
async fn test_get_user_notifications_by_event_item_ids_skips_invalid(pool: Pool<Postgres>) {
    let valid_item = uuid::Uuid::parse_str("a0000000-0000-0000-0000-000000000001").unwrap();
    let invalid_entity_item =
        uuid::Uuid::parse_str("a0000000-0000-0000-0000-000000000002").unwrap();
    let invalid_metadata_item =
        uuid::Uuid::parse_str("a0000000-0000-0000-0000-000000000003").unwrap();

    let result: Vec<UserNotificationRow<TestNotification>> = pool
        .get_user_notifications_by_event_item_ids(
            MacroUserIdStr::parse_from_str("macro|user@test.com").unwrap(),
            &[valid_item, invalid_entity_item, invalid_metadata_item],
            10,
            Query::Sort(CreatedAt, ()),
        )
        .await
        .unwrap();

    // All three are requested, but only the valid one survives filtering.
    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0].notification_id,
        uuid::Uuid::parse_str("0193b1ea-a542-7589-893b-2b4a509c1e76").unwrap()
    );
    assert_eq!(result[0].entity.entity_type, EntityType::Document);
    assert_eq!(result[0].notification_metadata.message, "hello");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_user_notifications_empty(pool: Pool<Postgres>) {
    let result: Vec<UserNotificationRow<TestNotification>> = pool
        .get_user_notifications(
            MacroUserIdStr::parse_from_str("macro|nobody@test.com").unwrap(),
            10,
            Query::Sort(CreatedAt, ()),
        )
        .await
        .unwrap();

    assert!(result.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_create_notification_returns_none_on_conflict(pool: Pool<Postgres>) {
    let recipient = test_user("recipient@test.com");
    let notification_id = uuid::Uuid::new_v4();

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("doc-1"),
        notification: TaggedContent::new(TestNotification {
            message: "hello".to_string(),
        }),
        sender_id: None,
        recipient_ids: std::collections::HashSet::from([recipient.clone()]),
    };

    // First creation should succeed
    let request2 = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("doc-1"),
        notification: TaggedContent::new(TestNotification {
            message: "hello".to_string(),
        }),
        sender_id: None,
        recipient_ids: std::collections::HashSet::from([recipient.clone()]),
    };

    let result = pool
        .create_notification(request, notification_id, "test_service", None)
        .await
        .unwrap();
    assert!(result.is_some());

    // Second creation with same ID should return None
    let result = pool
        .create_notification(request2, notification_id, "test_service", None)
        .await
        .unwrap();
    assert!(result.is_none());

    // Verify only one notification exists
    let count: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM notification WHERE id = $1",
        notification_id
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap();
    assert_eq!(count, 1);

    // Verify only one user_notification exists (not duplicated)
    let user_count: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM user_notification WHERE notification_id = $1",
        notification_id
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap();
    assert_eq!(user_count, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_notifications"))
)]
async fn test_delete_all_user_notifications(pool: Pool<Postgres>) {
    let user = MacroUserIdStr::parse_from_str("macro|user@test.com").unwrap();
    let notification_id = uuid::Uuid::parse_str("0193b1ea-a542-7589-893b-2b4a509c1e76").unwrap();

    // Verify the notification exists before deletion
    let count_before: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM user_notification WHERE user_id = $1",
        user.to_string()
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap();
    assert_eq!(count_before, 1);

    pool.delete_all_user_notifications(user.clone())
        .await
        .unwrap();

    // Verify the user_notification row is hard-deleted
    let count_after: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM user_notification WHERE user_id = $1",
        user.to_string()
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap();
    assert_eq!(count_after, 0);

    // Verify the parent notification record still exists
    let notif_count: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM notification WHERE id = $1",
        notification_id
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap();
    assert_eq!(notif_count, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_notifications"))
)]
async fn test_delete_all_user_notifications_does_not_affect_other_users(pool: Pool<Postgres>) {
    let user = MacroUserIdStr::parse_from_str("macro|user@test.com").unwrap();
    let other_user = test_user("other@test.com");
    let notification_id = uuid::Uuid::parse_str("0193b1ea-a542-7589-893b-2b4a509c1e76").unwrap();

    // Add a user_notification for the other user
    sqlx::query!(
        "INSERT INTO user_notification (user_id, notification_id, created_at) VALUES ($1, $2, '2025-01-01 00:00:00')",
        other_user.to_string(),
        notification_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    // Delete all notifications for the first user only
    pool.delete_all_user_notifications(user).await.unwrap();

    // The other user's notification should still exist
    let other_count: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM user_notification WHERE user_id = $1",
        other_user.to_string()
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap();
    assert_eq!(other_count, 1);
}
