//! Unit tests for the notification services.

use crate::domain::models::apple::APNSPushNotification;
use crate::domain::models::mobile::{MessageAttributes, PushType};
use crate::domain::models::queue_message::{
    ConnGatewayNotification, EmailContent, Node, NotificationChannel, QueueMessage, RawQueueMessage,
};
use crate::domain::models::{
    DeviceEndpoint, Notification, NotificationExtEmail, NotificationExtIos, RateLimitConfig,
    RateLimitExceeded, RateLimitKey, RateLimitResult, SendNotificationRequestBuilder,
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

    fn message_attributes(&self) -> crate::domain::models::mobile::MessageAttributes {
        MessageAttributes {
            push_type: PushType::Alert,
            collapse_key: "test".to_string(),
        }
    }

    fn into_apns(self) -> crate::domain::models::apple::APNSPushNotification<Self::NotifData> {
        APNSPushNotification {
            aps: Default::default(),
            push_notification_data: self,
        }
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
}

impl MockRepository {
    fn new() -> Self {
        Self {
            muted_users: HashSet::new(),
            unsubscribed_users: HashSet::new(),
            device_endpoints: HashMap::new(),
            created_notifications: Mutex::new(Vec::new()),
            stored_collapse_keys: Mutex::new(Vec::new()),
        }
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
    NotificationIngressService::new(repository, queue, "test_service")
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
    let service =
        NotificationIngressService::new(MockRepository::new(), queue.clone(), "test_service");

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
    let service =
        NotificationIngressService::new(MockRepository::new(), queue.clone(), "test_service");

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
    let service = NotificationIngressService::new(repo, queue.clone(), "test_service");

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

    let service = NotificationIngressService::new(repo, queue.clone(), "test_service");

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
    assert_eq!(attrs["collapse_key"], "test");

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

    let repo = Arc::new(
        MockRepository::new().with_device_endpoint(
            user.clone(),
            DeviceEndpoint::Ios("arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice".to_string()),
        ),
    );
    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(repo.clone(), queue, "test_service");

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
        Some("test".to_string()),
        "APNS collapse key should be stored when creating the notification"
    );
}

#[tokio::test]
async fn test_no_apns_collapse_key_when_apns_not_enabled() {
    use std::sync::Arc;

    let user = test_user_id("alice@example.com");

    let repo = Arc::new(MockRepository::new());
    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(repo.clone(), queue, "test_service");

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
        _message_type: &str,
        _notifications: Vec<(MacroUserIdStr<'a>, &T)>,
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
    MockRepository,
    MockWebSocketSender,
    MockMobileSender,
    MockEmailSender,
    R,
> {
    NotificationEgressService::new(
        MockRepository::new(),
        MockWebSocketSender,
        MockMobileSender,
        MockEmailSender,
        rate_limiter,
    )
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
                notif: json!({"message": "Hello"}),
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
                notif: json!({"message": "Hello"}),
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
                notif: json!({"message": "Hello"}),
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
