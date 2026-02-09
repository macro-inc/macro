//! Unit tests for the notification services.

use crate::domain::models::apple::APNSPushNotification;
use crate::domain::models::mobile::NotifCollapseKey;
use crate::domain::models::queue_message::{
    ConnGatewayNotification, EmailContent, Node, Notif, NotificationChannel, QueueMessage,
    RawQueueMessage,
};
use crate::domain::models::request::{NotificationStatus, UpdateNotificationsRequest};
use crate::domain::models::{
    DeviceEndpoint, Notification, NotificationExtEmail, NotificationExtIos,
    NotificationIdAndCollapseKey, RateLimitConfig, RateLimitExceeded, RateLimitKey,
    RateLimitResult, SendNotificationRequestBuilder, UserNotificationRow,
};
use crate::domain::ports::{
    EmailSender, NotificationQueue, NotificationRepository, NotificationSender, RateLimitPort,
    WebSocketSender,
};
use crate::domain::service::{
    NotificationEgressService, NotificationIngress, NotificationIngressService,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use rootcause::Report;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;
use uuid::Uuid;

/// A test notification type.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct TestNotification {
    message: String,
}

impl Notification for TestNotification {
    const TYPE_NAME: &'static str = "test_notification";

    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
    }
}

impl NotificationExtIos for TestNotification {
    type NotifData = TestNotification;

    fn collapse_key(&self, _entity: &model_entity::Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new("test")
    }

    fn into_apns<'a>(
        self,
        _sender: Option<MacroUserIdStr<'a>>,
        _entity: &model_entity::Entity<'_>,
        _notification_id: uuid::Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        Some(APNSPushNotification {
            aps: Default::default(),
            push_notification_data: self,
        })
    }
}

impl NotificationExtEmail for TestNotification {
    fn into_email(self) -> crate::domain::models::queue_message::EmailContent {
        EmailContent {
            subject: "Test".to_string(),
            body: self.message,
        }
    }
}

/// Helper to create a test user ID.
fn test_user_id(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

/// Mock repository that tracks calls.
struct MockRepository {
    muted_users: HashSet<MacroUserIdStr<'static>>,
    unsubscribed_users: HashSet<MacroUserIdStr<'static>>,
    device_endpoints: HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>,
    created_notifications: Mutex<Vec<Uuid>>,
    stored_collapse_keys: Mutex<Vec<(Uuid, Option<String>)>>,
    basic_notifications: Vec<NotificationIdAndCollapseKey>,
    mark_seen_calls: Mutex<Vec<(String, Vec<Uuid>)>>,
    mark_done_calls: Mutex<Vec<(String, Vec<Uuid>, bool)>>,
}

impl MockRepository {
    fn new() -> Self {
        Self {
            muted_users: HashSet::new(),
            unsubscribed_users: HashSet::new(),
            device_endpoints: HashMap::new(),
            created_notifications: Mutex::new(Vec::new()),
            stored_collapse_keys: Mutex::new(Vec::new()),
            basic_notifications: Vec::new(),
            mark_seen_calls: Mutex::new(Vec::new()),
            mark_done_calls: Mutex::new(Vec::new()),
        }
    }

    fn with_basic_notification(mut self, id: Uuid, collapse_key: String) -> Self {
        self.basic_notifications.push(NotificationIdAndCollapseKey {
            id,
            apns_collapse_key: collapse_key,
        });
        self
    }

    fn with_muted_user(mut self, user_id: MacroUserIdStr<'static>) -> Self {
        self.muted_users.insert(user_id);
        self
    }

    fn with_unsubscribed_user(mut self, user_id: MacroUserIdStr<'static>) -> Self {
        self.unsubscribed_users.insert(user_id);
        self
    }

    fn with_device_endpoint(
        mut self,
        user_id: MacroUserIdStr<'static>,
        endpoint: DeviceEndpoint,
    ) -> Self {
        self.device_endpoints
            .entry(user_id)
            .or_default()
            .push(endpoint);
        self
    }
}

impl NotificationRepository for MockRepository {
    async fn get_muted_users<'a>(
        &self,
        _user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        Ok(self.muted_users.clone())
    }

    async fn get_unsubscribed_users<'a>(
        &self,
        _item_id: &str,
        _user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        Ok(self.unsubscribed_users.clone())
    }

    async fn create_notification<'a, T: Notification + Send + Sync>(
        &self,
        _request: &SendNotificationRequestBuilder<'a, T>,
        notification_id: Uuid,
        _service_sender: &str,
        apns_collapse_key: Option<&str>,
    ) -> Result<Option<Uuid>, Report> {
        self.created_notifications
            .lock()
            .unwrap()
            .push(notification_id);
        self.stored_collapse_keys
            .lock()
            .unwrap()
            .push((notification_id, apns_collapse_key.map(String::from)));
        Ok(Some(notification_id))
    }

    async fn update_sent_status<'a>(
        &self,
        _notification_id: Uuid,
        _user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn get_device_endpoints<'a>(
        &self,
        _user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>, Report> {
        Ok(self.device_endpoints.clone())
    }

    async fn mark_notifications_seen(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<(), Report> {
        self.mark_seen_calls
            .lock()
            .unwrap()
            .push((user_id.to_string(), notification_ids.to_vec()));
        Ok(())
    }

    async fn mark_notifications_done(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
        done: bool,
    ) -> Result<(), Report> {
        self.mark_done_calls.lock().unwrap().push((
            user_id.to_string(),
            notification_ids.to_vec(),
            done,
        ));
        Ok(())
    }

    async fn get_basic_notifications(
        &self,
        _notification_ids: &[Uuid],
    ) -> Result<Vec<NotificationIdAndCollapseKey>, Report> {
        Ok(self.basic_notifications.clone())
    }

    async fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        _user_id: &str,
        _limit: u32,
        _cursor: models_pagination::Query<Uuid, models_pagination::CreatedAt, ()>,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        Ok(vec![])
    }

    async fn get_user_notifications_by_event_item_ids<T: DeserializeOwned + Send>(
        &self,
        _user_id: &str,
        _event_item_ids: &[Uuid],
        _limit: u32,
        _cursor: models_pagination::Query<Uuid, models_pagination::CreatedAt, ()>,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        Ok(vec![])
    }

    async fn get_user_notification_by_id<T: DeserializeOwned + Send>(
        &self,
        _user_id: &str,
        _notification_id: Uuid,
    ) -> Result<Option<UserNotificationRow<T>>, Report> {
        Ok(None)
    }

    async fn delete_user_notification(
        &self,
        _user_id: &str,
        _notification_id: Uuid,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn bulk_delete_user_notifications(
        &self,
        _user_id: &str,
        _notification_ids: &[Uuid],
    ) -> Result<(), Report> {
        Ok(())
    }
}

impl NotificationRepository for std::sync::Arc<MockRepository> {
    async fn get_muted_users<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        (**self).get_muted_users(user_ids).await
    }

    async fn get_unsubscribed_users<'a>(
        &self,
        item_id: &str,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        (**self).get_unsubscribed_users(item_id, user_ids).await
    }

    async fn create_notification<'a, T: Notification + Send + Sync>(
        &self,
        request: &SendNotificationRequestBuilder<'a, T>,
        notification_id: Uuid,
        service_sender: &str,
        apns_collapse_key: Option<&str>,
    ) -> Result<Option<Uuid>, Report> {
        (**self)
            .create_notification(request, notification_id, service_sender, apns_collapse_key)
            .await
    }

    async fn update_sent_status<'a>(
        &self,
        notification_id: Uuid,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<(), Report> {
        (**self).update_sent_status(notification_id, user_ids).await
    }

    async fn get_device_endpoints<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>, Report> {
        (**self).get_device_endpoints(user_ids).await
    }

    async fn mark_notifications_seen(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<(), Report> {
        (**self)
            .mark_notifications_seen(user_id, notification_ids)
            .await
    }

    async fn mark_notifications_done(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
        done: bool,
    ) -> Result<(), Report> {
        (**self)
            .mark_notifications_done(user_id, notification_ids, done)
            .await
    }

    async fn get_basic_notifications(
        &self,
        notification_ids: &[Uuid],
    ) -> Result<Vec<NotificationIdAndCollapseKey>, Report> {
        (**self).get_basic_notifications(notification_ids).await
    }

    async fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        user_id: &str,
        limit: u32,
        cursor: models_pagination::Query<Uuid, models_pagination::CreatedAt, ()>,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        (**self)
            .get_user_notifications(user_id, limit, cursor)
            .await
    }

    async fn get_user_notifications_by_event_item_ids<T: DeserializeOwned + Send>(
        &self,
        user_id: &str,
        event_item_ids: &[Uuid],
        limit: u32,
        cursor: models_pagination::Query<Uuid, models_pagination::CreatedAt, ()>,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        (**self)
            .get_user_notifications_by_event_item_ids(user_id, event_item_ids, limit, cursor)
            .await
    }

    async fn get_user_notification_by_id<T: DeserializeOwned + Send>(
        &self,
        user_id: &str,
        notification_id: Uuid,
    ) -> Result<Option<UserNotificationRow<T>>, Report> {
        (**self)
            .get_user_notification_by_id(user_id, notification_id)
            .await
    }

    async fn delete_user_notification(
        &self,
        user_id: &str,
        notification_id: Uuid,
    ) -> Result<(), Report> {
        (**self)
            .delete_user_notification(user_id, notification_id)
            .await
    }

    async fn bulk_delete_user_notifications(
        &self,
        user_id: &str,
        notification_ids: &[Uuid],
    ) -> Result<(), Report> {
        (**self)
            .bulk_delete_user_notifications(user_id, notification_ids)
            .await
    }
}

/// Mock queue that tracks published messages.
struct MockQueue {
    /// Stores serialized messages as JSON strings for inspection.
    published: Mutex<Vec<serde_json::Value>>,
}

impl MockQueue {
    fn new() -> Self {
        Self {
            published: Mutex::new(Vec::new()),
        }
    }

    fn get_published(&self) -> Vec<serde_json::Value> {
        self.published.lock().unwrap().clone()
    }
}

impl NotificationQueue for MockQueue {
    async fn publish<T: serde::Serialize + Send + Sync, U: serde::Serialize + Send + Sync>(
        &self,
        messages: &[QueueMessage<'_, T, U>],
    ) -> Result<(), Report> {
        let mut published = self.published.lock().unwrap();
        for message in messages {
            let json = serde_json::to_value(message).unwrap();
            published.push(json);
        }
        Ok(())
    }

    async fn receive_messages(&self) -> Result<Vec<RawQueueMessage>, Report> {
        Ok(Vec::new())
    }

    async fn delete_message(&self, _receipt_handle: &str) -> Result<(), Report> {
        Ok(())
    }
}

impl NotificationQueue for std::sync::Arc<MockQueue> {
    async fn publish<T: serde::Serialize + Send + Sync, U: serde::Serialize + Send + Sync>(
        &self,
        messages: &[QueueMessage<'_, T, U>],
    ) -> Result<(), Report> {
        (**self).publish(messages).await
    }

    async fn receive_messages(&self) -> Result<Vec<RawQueueMessage>, Report> {
        (**self).receive_messages().await
    }

    async fn delete_message(&self, _receipt_handle: &str) -> Result<(), Report> {
        (**self).delete_message(_receipt_handle).await
    }
}

fn create_service<N, Q>(repository: N, queue: Q) -> NotificationIngressService<N, Q>
where
    N: NotificationRepository,
    Q: NotificationQueue,
{
    NotificationIngressService::new(repository, queue)
}

#[tokio::test]
async fn test_send_notification_success() {
    let service = create_service(MockRepository::new(), MockQueue::new());

    let recipient = test_user_id("user@example.com");
    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([recipient.clone()]),
    }
    .into_request();

    let result = service.send_notification(request).await.unwrap().unwrap();

    assert!(result.notified_recipients.contains(&recipient));
}

#[tokio::test]
async fn test_sender_excluded_from_recipients() {
    let service = create_service(MockRepository::new(), MockQueue::new());

    let sender = test_user_id("sender@example.com");
    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: Some(sender.clone()),
        recipient_ids: HashSet::from([sender.clone()]),
    }
    .into_request();

    let result = service.send_notification(request).await.unwrap();

    // Sender should be excluded, no valid recipients remain
    assert!(result.is_none());
}

#[tokio::test]
async fn test_muted_user_excluded() {
    let muted_user = test_user_id("muted@example.com");
    let service = create_service(
        MockRepository::new().with_muted_user(muted_user.clone()),
        MockQueue::new(),
    );

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([muted_user]),
    }
    .into_request();

    let result = service.send_notification(request).await.unwrap();

    // Muted user should be excluded, no valid recipients remain
    assert!(result.is_none());
}

#[tokio::test]
async fn test_unsubscribed_user_excluded() {
    let unsubscribed_user = test_user_id("unsubscribed@example.com");
    let service = create_service(
        MockRepository::new().with_unsubscribed_user(unsubscribed_user.clone()),
        MockQueue::new(),
    );

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([unsubscribed_user]),
    }
    .into_request();

    let result = service.send_notification(request).await.unwrap();

    // Unsubscribed user should be excluded, no valid recipients remain
    assert!(result.is_none());
}

#[tokio::test]
async fn test_queue_message_conn_gateway_only() {
    use std::sync::Arc;

    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(MockRepository::new(), queue.clone());

    let recipient = test_user_id("user@example.com");
    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([recipient.clone()]),
    }
    .into_request()
    .with_conn_gateway();

    service.send_notification(request).await.unwrap();

    let published = queue.get_published();
    assert_eq!(published.len(), 1);

    let msg = &published[0];
    assert_eq!(msg["message_type"], "test_notification");
    assert!(msg["content"]["notif"]["ConnGateway"].is_object());
}

#[tokio::test]
async fn test_queue_message_email_per_recipient() {
    use std::sync::Arc;

    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(MockRepository::new(), queue.clone());

    let recipient1 = test_user_id("user1@example.com");
    let recipient2 = test_user_id("user2@example.com");
    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([recipient1.clone(), recipient2.clone()]),
    }
    .into_request()
    .with_email();

    service.send_notification(request).await.unwrap();

    let published = queue.get_published();
    // Email is 1:1, so we should have 2 messages (one per recipient)
    assert_eq!(published.len(), 2);

    for msg in &published {
        assert_eq!(msg["message_type"], "test_notification");
        assert!(msg["content"]["notif"]["Email"].is_object());
    }
}

#[tokio::test]
async fn test_queue_message_multiple_channels() {
    use std::sync::Arc;

    let recipient = test_user_id("user@example.com");
    let queue = Arc::new(MockQueue::new());
    let repo = MockRepository::new().with_device_endpoint(
        recipient.clone(),
        DeviceEndpoint::Ios("arn:aws:sns:test".to_string()),
    );
    let service = NotificationIngressService::new(repo, queue.clone());

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([recipient.clone()]),
    }
    .into_request()
    .with_conn_gateway()
    .with_apns()
    .with_email();

    service.send_notification(request).await.unwrap();

    let published = queue.get_published();
    // Should have 3 messages: 1 conn_gateway + 1 iOS + 1 email
    assert_eq!(published.len(), 3);

    let has_conn_gateway = published
        .iter()
        .any(|m| m["content"]["notif"]["ConnGateway"].is_object());
    let has_ios = published
        .iter()
        .any(|m| m["content"]["notif"]["Ios"].is_object());
    let has_email = published
        .iter()
        .any(|m| m["content"]["notif"]["Email"].is_object());

    assert!(has_conn_gateway, "Should have ConnGateway message");
    assert!(has_ios, "Should have iOS message");
    assert!(has_email, "Should have Email message");
}

#[tokio::test]
async fn test_apns_enqueues_correct_data_for_multiple_users() {
    use std::sync::Arc;

    let user1 = test_user_id("alice@example.com");
    let user2 = test_user_id("bob@example.com");
    let user3 = test_user_id("charlie@example.com");

    let queue = Arc::new(MockQueue::new());
    let repo = MockRepository::new()
        .with_device_endpoint(
            user1.clone(),
            DeviceEndpoint::Ios(
                "arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice-device".to_string(),
            ),
        )
        .with_device_endpoint(
            user2.clone(),
            DeviceEndpoint::Ios(
                "arn:aws:sns:us-east-1:111:endpoint/APNS/app/bob-device".to_string(),
            ),
        )
        .with_device_endpoint(
            user2.clone(),
            DeviceEndpoint::Ios(
                "arn:aws:sns:us-east-1:111:endpoint/APNS/app/bob-device-2".to_string(),
            ),
        )
        .with_device_endpoint(
            user3.clone(),
            DeviceEndpoint::Ios(
                "arn:aws:sns:us-east-1:111:endpoint/APNS/app/charlie-device".to_string(),
            ),
        );

    let service = NotificationIngressService::new(repo, queue.clone());

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("doc_123"),
        notification: TestNotification {
            message: "You were mentioned".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([user1.clone(), user2.clone(), user3.clone()]),
    }
    .into_request()
    .with_apns();

    service.send_notification(request).await.unwrap();

    let published = queue.get_published();
    assert_eq!(
        published.len(),
        1,
        "APNS produces a single queue message for all recipients"
    );

    let msg = &published[0];
    assert_eq!(msg["message_type"], "test_notification");

    // The message should be an Ios variant
    let ios = &msg["content"]["notif"]["Ios"];
    assert!(ios.is_object(), "Expected Ios notification channel");

    // Verify the APNS notification payload contains the notification data
    // push_notification_data is #[serde(flatten)]'d so fields appear directly on notif
    let apns_notif = &ios["notif"];
    assert_eq!(
        apns_notif["message"], "You were mentioned",
        "APNS payload should contain the flattened notification data"
    );

    // Verify message attributes
    let attrs = &ios["attributes"];
    assert_eq!(attrs["push_type"], "Alert");
    let expected_key = NotifCollapseKey::new("test").into_hashed().into_inner();
    assert_eq!(attrs["collapse_key"], expected_key);

    // Verify all device endpoints from all users are included
    let endpoints: Vec<&str> = ios["ios_device_endpoints"]
        .as_array()
        .expect("iosDeviceEndpoints should be an array")
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();

    assert_eq!(
        endpoints.len(),
        4,
        "Should include all 4 device endpoints across 3 users"
    );
    assert!(
        endpoints.contains(&"arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice-device"),
        "Should include alice's device"
    );
    assert!(
        endpoints.contains(&"arn:aws:sns:us-east-1:111:endpoint/APNS/app/bob-device"),
        "Should include bob's first device"
    );
    assert!(
        endpoints.contains(&"arn:aws:sns:us-east-1:111:endpoint/APNS/app/bob-device-2"),
        "Should include bob's second device"
    );
    assert!(
        endpoints.contains(&"arn:aws:sns:us-east-1:111:endpoint/APNS/app/charlie-device"),
        "Should include charlie's device"
    );
}

#[tokio::test]
async fn test_apns_collapse_key_stored_on_create() {
    use std::sync::Arc;

    let user = test_user_id("alice@example.com");

    let repo = Arc::new(MockRepository::new().with_device_endpoint(
        user.clone(),
        DeviceEndpoint::Ios("arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice".to_string()),
    ));
    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(repo.clone(), queue);

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("doc_1"),
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([user]),
    }
    .into_request()
    .with_apns();

    service.send_notification(request).await.unwrap();

    let collapse_keys = repo.stored_collapse_keys.lock().unwrap();
    assert_eq!(collapse_keys.len(), 1);
    assert_eq!(
        collapse_keys[0].1,
        Some(NotifCollapseKey::new("test").into_hashed().into_inner()),
        "APNS collapse key should be stored when creating the notification"
    );
}

#[tokio::test]
async fn test_no_apns_collapse_key_when_apns_not_enabled() {
    use std::sync::Arc;

    let user = test_user_id("alice@example.com");

    let repo = Arc::new(MockRepository::new());
    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(repo.clone(), queue);

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("doc_1"),
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([user]),
    }
    .into_request()
    .with_conn_gateway();

    service.send_notification(request).await.unwrap();

    let collapse_keys = repo.stored_collapse_keys.lock().unwrap();
    assert_eq!(collapse_keys.len(), 1);
    assert_eq!(
        collapse_keys[0].1, None,
        "No APNS collapse key should be stored when APNS is not enabled"
    );
}

// ============================================================================
// Egress Service Tests
// ============================================================================

/// Mock WebSocket sender that always succeeds.
struct MockWebSocketSender;

impl WebSocketSender for MockWebSocketSender {
    async fn send_notifications<'a, T: Serialize + Send + Sync>(
        &self,
        _recipients: &[MacroUserIdStr<'a>],
        _notification: &T,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        Ok(HashSet::new())
    }
}

/// Mock mobile push sender.
struct MockMobileSender;

impl NotificationSender for MockMobileSender {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        _endpoint_arn: &str,
        _notification: &crate::domain::models::apple::APNSPushNotification<T>,
        _attributes: &crate::domain::models::mobile::MessageAttributes,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        _endpoint_arn: &str,
        _notification: &crate::domain::models::android::FCMMessage<T>,
        _attributes: &crate::domain::models::mobile::MessageAttributes,
    ) -> Result<(), Report> {
        Ok(())
    }
}

/// Mock email sender.
struct MockEmailSender;

impl EmailSender for MockEmailSender {
    async fn send_email(
        &self,
        _recipient: MacroUserIdStr<'_>,
        _content: &crate::domain::models::queue_message::EmailContent,
    ) -> Result<(), Report> {
        Ok(())
    }
}

/// Mock rate limiter that can be configured to allow or exceed.
struct MockRateLimiter {
    should_exceed: bool,
}

impl MockRateLimiter {
    fn allowing() -> Self {
        Self {
            should_exceed: false,
        }
    }

    fn exceeding() -> Self {
        Self {
            should_exceed: true,
        }
    }
}

impl RateLimitPort for MockRateLimiter {
    async fn check_and_increment(
        &self,
        _key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        if self.should_exceed {
            Ok(RateLimitResult::Exceeded(RateLimitExceeded {
                key: "test_key".to_string(),
                current_count: config.max_count + 1,
                max_count: config.max_count,
            }))
        } else {
            Ok(RateLimitResult::Allowed { current_count: 1 })
        }
    }
}

fn create_egress_service<R: RateLimitPort>(
    rate_limiter: R,
) -> NotificationEgressService<
    MockQueue,
    MockRepository,
    MockWebSocketSender,
    MockMobileSender,
    MockEmailSender,
    R,
> {
    NotificationEgressService::new(
        MockQueue::new(),
        MockRepository::new(),
        MockWebSocketSender,
        MockMobileSender,
        MockEmailSender,
        rate_limiter,
    )
}

fn create_mock_notif(meta: serde_json::Value) -> Notif<serde_json::Value> {
    Notif {
        notification_id: Uuid::nil(),
        notification_event_type: "testing".to_string(),
        entity: EntityType::Document.with_entity_str("testing"),
        sent: false,
        done: false,
        created_at: None,
        viewed_at: None,
        updated_at: None,
        deleted_at: None,
        notification_metadata: meta,
        sender_id: None,
    }
}

#[tokio::test]
async fn test_egress_rate_limit_exceeded() {
    let service = create_egress_service(MockRateLimiter::exceeding());

    let recipient = test_user_id("user@example.com");
    let message = QueueMessage {
        message_type: "test_notification".to_string(),
        rate_limit: Some((
            RateLimitKey::from_str_hashed("test"),
            RateLimitConfig::new(10, Duration::from_secs(3600)),
        )),
        content: Node {
            notif: NotificationChannel::ConnGateway(ConnGatewayNotification {
                notif: create_mock_notif(json!({"message": "Hello"})),
                recipients: vec![recipient],
            }),
            on_failure: None,
        },
    };

    let results = service.deliver_notification(message).await;

    // Should have exactly one error result for rate limit exceeded
    assert_eq!(results.len(), 1);
    assert!(results[0].is_err());

    let err = results[0].as_ref().unwrap_err();
    assert!(
        err.to_string().contains("rate limit"),
        "Error should mention rate limit: {}",
        err
    );
}

#[tokio::test]
async fn test_egress_rate_limit_allowed() {
    let service = create_egress_service(MockRateLimiter::allowing());

    let recipient = test_user_id("user@example.com");
    let message = QueueMessage {
        message_type: "test_notification".to_string(),
        rate_limit: Some((
            RateLimitKey::from_str_hashed("test"),
            RateLimitConfig::new(10, Duration::from_secs(3600)),
        )),
        content: Node {
            notif: NotificationChannel::ConnGateway(ConnGatewayNotification {
                notif: create_mock_notif(json!({"message": "Hello"})),

                recipients: vec![recipient],
            }),
            on_failure: None,
        },
    };

    let results = service.deliver_notification(message).await;

    // Should succeed
    assert_eq!(results.len(), 1);
    assert!(results[0].is_ok());
}

#[tokio::test]
async fn test_egress_no_rate_limit_configured() {
    let service = create_egress_service(MockRateLimiter::exceeding());

    let recipient = test_user_id("user@example.com");
    let message = QueueMessage {
        message_type: "test_notification".to_string(),
        rate_limit: None, // No rate limit configured
        content: Node {
            notif: NotificationChannel::ConnGateway(ConnGatewayNotification {
                notif: create_mock_notif(json!({"message": "Hello"})),
                recipients: vec![recipient],
            }),
            on_failure: None,
        },
    };

    let results = service.deliver_notification(message).await;

    // Should succeed even though rate limiter would exceed - because no rate limit is configured
    assert_eq!(results.len(), 1);
    assert!(results[0].is_ok());
}

// ============================================================================
// Mark Notifications Seen Tests
// ============================================================================

#[tokio::test]
async fn test_mark_seen_publishes_ios_clear_message() {
    use std::sync::Arc;

    let user = test_user_id("alice@example.com");
    let notif_id = Uuid::now_v7();

    let repo = Arc::new(
        MockRepository::new()
            .with_basic_notification(notif_id, "collapse_key_1".to_string())
            .with_device_endpoint(
                user.clone(),
                DeviceEndpoint::Ios(
                    "arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice".to_string(),
                ),
            ),
    );
    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(repo.clone(), queue.clone());

    let notification_ids = [notif_id];
    service
        .update_notifications(UpdateNotificationsRequest {
            user_id: user.clone(),
            notification_ids: &notification_ids,
            status: NotificationStatus::Seen,
        })
        .await
        .unwrap();

    // Verify DB was updated
    let mark_seen_calls = repo.mark_seen_calls.lock().unwrap();
    assert_eq!(mark_seen_calls.len(), 1);
    assert_eq!(mark_seen_calls[0].1, vec![notif_id]);

    // Verify queue message was published
    let published = queue.get_published();
    assert_eq!(published.len(), 1);

    let msg = &published[0];
    assert_eq!(msg["message_type"], "clear_push_notification");

    // Should be an Ios variant with background push
    let ios = &msg["content"]["notif"]["Ios"];
    assert!(ios.is_object(), "Expected Ios notification channel");

    // Verify silent background push payload
    let aps = &ios["notif"]["aps"];
    assert_eq!(aps["content-available"], 1);
    assert!(aps.get("alert").is_none() || aps["alert"].is_null());

    // Verify collapse key in attributes
    let attrs = &ios["attributes"];
    assert_eq!(attrs["push_type"], "Background");
    assert_eq!(attrs["collapse_key"], "collapse_key_1");

    // Verify identifier in custom data
    assert_eq!(ios["notif"]["identifier"], "collapse_key_1");

    // Verify device endpoint
    let endpoints = ios["ios_device_endpoints"].as_array().unwrap();
    assert_eq!(endpoints.len(), 1);
    assert_eq!(
        endpoints[0],
        "arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice"
    );
}

#[tokio::test]
async fn test_mark_seen_skips_push_when_no_collapse_key() {
    use std::sync::Arc;

    let user = test_user_id("bob@example.com");
    let notif_id = Uuid::now_v7();

    // No basic notifications with collapse keys (DB query filters them out)
    let repo = Arc::new(MockRepository::new().with_device_endpoint(
        user.clone(),
        DeviceEndpoint::Ios("arn:aws:sns:us-east-1:111:endpoint/APNS/app/bob".to_string()),
    ));
    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(repo.clone(), queue.clone());

    let notification_ids = [notif_id];
    service
        .update_notifications(UpdateNotificationsRequest {
            user_id: user.clone(),
            notification_ids: &notification_ids,
            status: NotificationStatus::Seen,
        })
        .await
        .unwrap();

    // DB should still be updated
    let mark_seen_calls = repo.mark_seen_calls.lock().unwrap();
    assert_eq!(mark_seen_calls.len(), 1);

    // But no queue message should be published
    let published = queue.get_published();
    assert!(
        published.is_empty(),
        "Should not publish when no collapse keys"
    );
}

#[tokio::test]
async fn test_mark_seen_skips_push_when_no_device_endpoints() {
    use std::sync::Arc;

    let user = test_user_id("charlie@example.com");
    let notif_id = Uuid::now_v7();

    let repo = Arc::new(
        MockRepository::new().with_basic_notification(notif_id, "collapse_key_1".to_string()),
        // No device endpoints registered
    );
    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(repo.clone(), queue.clone());

    let notification_ids = [notif_id];
    service
        .update_notifications(UpdateNotificationsRequest {
            user_id: user.clone(),
            notification_ids: &notification_ids,
            status: NotificationStatus::Seen,
        })
        .await
        .unwrap();

    // DB should still be updated
    let mark_seen_calls = repo.mark_seen_calls.lock().unwrap();
    assert_eq!(mark_seen_calls.len(), 1);

    // But no queue message should be published
    let published = queue.get_published();
    assert!(
        published.is_empty(),
        "Should not publish when no device endpoints"
    );
}

#[tokio::test]
async fn test_mark_done_updates_db_and_clears_push() {
    use std::sync::Arc;

    let user = test_user_id("alice@example.com");
    let notif_id = Uuid::now_v7();

    let repo = Arc::new(
        MockRepository::new()
            .with_basic_notification(notif_id, "collapse_key_1".to_string())
            .with_device_endpoint(
                user.clone(),
                DeviceEndpoint::Ios(
                    "arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice".to_string(),
                ),
            ),
    );
    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(repo.clone(), queue.clone());

    let notification_ids = [notif_id];
    service
        .update_notifications(UpdateNotificationsRequest {
            user_id: user.clone(),
            notification_ids: &notification_ids,
            status: NotificationStatus::Done(true),
        })
        .await
        .unwrap();

    // Verify done was called (not seen)
    let mark_seen_calls = repo.mark_seen_calls.lock().unwrap();
    assert!(mark_seen_calls.is_empty(), "Should not call mark_seen");

    let mark_done_calls = repo.mark_done_calls.lock().unwrap();
    assert_eq!(mark_done_calls.len(), 1);
    assert_eq!(mark_done_calls[0].1, vec![notif_id]);
    assert!(mark_done_calls[0].2, "Should mark as done=true");

    // Verify push clearing was published (Done(true) should clear push)
    let published = queue.get_published();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0]["message_type"], "clear_push_notification");
}

#[tokio::test]
async fn test_mark_undone_updates_db_no_push_clear() {
    use std::sync::Arc;

    let user = test_user_id("alice@example.com");
    let notif_id = Uuid::now_v7();

    let repo = Arc::new(
        MockRepository::new()
            .with_basic_notification(notif_id, "collapse_key_1".to_string())
            .with_device_endpoint(
                user.clone(),
                DeviceEndpoint::Ios(
                    "arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice".to_string(),
                ),
            ),
    );
    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(repo.clone(), queue.clone());

    let notification_ids = [notif_id];
    service
        .update_notifications(UpdateNotificationsRequest {
            user_id: user.clone(),
            notification_ids: &notification_ids,
            status: NotificationStatus::Done(false),
        })
        .await
        .unwrap();

    // Verify done was called with false
    let mark_done_calls = repo.mark_done_calls.lock().unwrap();
    assert_eq!(mark_done_calls.len(), 1);
    assert!(!mark_done_calls[0].2, "Should mark as done=false");

    // Verify NO push clearing was published (Done(false) should not clear push)
    let published = queue.get_published();
    assert!(
        published.is_empty(),
        "Should not clear push when marking undone"
    );
}

/// Mock mobile sender that tracks attempted endpoints and can fail specific ones.
struct TrackingMobileSender {
    /// Endpoints that were attempted (for verification).
    attempted_endpoints: Mutex<Vec<String>>,
    /// Endpoints that should fail when attempted.
    failing_endpoints: HashSet<String>,
}

impl TrackingMobileSender {
    fn new(failing_endpoints: HashSet<String>) -> Self {
        Self {
            attempted_endpoints: Mutex::new(Vec::new()),
            failing_endpoints,
        }
    }

    fn get_attempted_endpoints(&self) -> Vec<String> {
        self.attempted_endpoints.lock().unwrap().clone()
    }
}

impl NotificationSender for TrackingMobileSender {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        _notification: &crate::domain::models::apple::APNSPushNotification<T>,
        _attributes: &crate::domain::models::mobile::MessageAttributes,
    ) -> Result<(), Report> {
        // Track that this endpoint was attempted
        self.attempted_endpoints
            .lock()
            .unwrap()
            .push(endpoint_arn.to_string());

        // Fail if this endpoint is in the failing set
        if self.failing_endpoints.contains(endpoint_arn) {
            rootcause::bail!("Simulated APNS failure for endpoint: {}", endpoint_arn);
        }

        Ok(())
    }

    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        _endpoint_arn: &str,
        _notification: &crate::domain::models::android::FCMMessage<T>,
        _attributes: &crate::domain::models::mobile::MessageAttributes,
    ) -> Result<(), Report> {
        Ok(())
    }
}

#[tokio::test]
async fn test_egress_ios_attempts_all_endpoints_even_if_some_fail() {
    use crate::domain::models::apple::{APNSPushNotification, Aps};
    use crate::domain::models::mobile::{MessageAttributes, PushType};
    use crate::domain::models::queue_message::APNSTargets;

    let endpoint1 = "arn:aws:sns:us-east-1:111:endpoint/APNS/app/device1";
    let endpoint2 = "arn:aws:sns:us-east-1:111:endpoint/APNS/app/device2";
    let endpoint3 = "arn:aws:sns:us-east-1:111:endpoint/APNS/app/device3";
    let endpoint4 = "arn:aws:sns:us-east-1:111:endpoint/APNS/app/device4";

    // Configure endpoints 1 and 3 to fail
    let failing_endpoints: HashSet<String> = [endpoint1.to_string(), endpoint3.to_string()].into();

    let mobile_sender = std::sync::Arc::new(TrackingMobileSender::new(failing_endpoints));
    let service = NotificationEgressService::new(
        MockQueue::new(),
        MockRepository::new(),
        MockWebSocketSender,
        mobile_sender.clone(),
        MockEmailSender,
        MockRateLimiter::allowing(),
    );

    let message = QueueMessage {
        message_type: "test_notification".to_string(),
        rate_limit: None,
        content: Node {
            notif: NotificationChannel::Ios(Box::new(APNSTargets {
                notif: APNSPushNotification {
                    aps: Aps::default(),
                    push_notification_data: json!({"message": "Hello"}),
                },
                attributes: MessageAttributes {
                    push_type: PushType::Alert,
                    collapse_key: "test_collapse".to_string(),
                },
                ios_device_endpoints: vec![
                    endpoint1.to_string(),
                    endpoint2.to_string(),
                    endpoint3.to_string(),
                    endpoint4.to_string(),
                ],
            })),
            on_failure: None,
        },
    };

    let results = service.deliver_notification(message).await;

    // Verify ALL 4 endpoints were attempted
    let attempted = mobile_sender.get_attempted_endpoints();
    assert_eq!(
        attempted.len(),
        4,
        "Should attempt delivery to all 4 endpoints, but only attempted: {:?}",
        attempted
    );
    assert!(
        attempted.contains(&endpoint1.to_string()),
        "Should attempt endpoint1"
    );
    assert!(
        attempted.contains(&endpoint2.to_string()),
        "Should attempt endpoint2"
    );
    assert!(
        attempted.contains(&endpoint3.to_string()),
        "Should attempt endpoint3"
    );
    assert!(
        attempted.contains(&endpoint4.to_string()),
        "Should attempt endpoint4"
    );

    // Verify we got 4 results (one per endpoint)
    assert_eq!(results.len(), 4, "Should have 4 results (one per endpoint)");

    // Verify 2 succeeded and 2 failed
    let successes = results.iter().filter(|r| r.is_ok()).count();
    let failures = results.iter().filter(|r| r.is_err()).count();
    assert_eq!(successes, 2, "Should have 2 successful deliveries");
    assert_eq!(failures, 2, "Should have 2 failed deliveries");
}

impl NotificationSender for std::sync::Arc<TrackingMobileSender> {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        notification: &crate::domain::models::apple::APNSPushNotification<T>,
        attributes: &crate::domain::models::mobile::MessageAttributes,
    ) -> Result<(), Report> {
        (**self)
            .send_ios_push_notification(endpoint_arn, notification, attributes)
            .await
    }

    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        notification: &crate::domain::models::android::FCMMessage<T>,
        attributes: &crate::domain::models::mobile::MessageAttributes,
    ) -> Result<(), Report> {
        (**self)
            .send_android_push_notification(endpoint_arn, notification, attributes)
            .await
    }
}
