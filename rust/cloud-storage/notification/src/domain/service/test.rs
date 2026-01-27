//! Unit tests for the NotificationIngressService.

use crate::domain::models::queue_message::{QueueMessage, RawQueueMessage};
use crate::domain::models::{
    DeviceEndpoint, Notification, RateLimitConfig, RateLimitKey, RevokeCriteria,
    SendNotificationRequestBuilder,
};
use crate::domain::ports::{NotificationQueue, NotificationRepository};
use crate::domain::service::NotificationIngressService;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use uuid::Uuid;

/// A test notification type.
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

    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
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
    created_notifications: Mutex<Vec<Uuid>>,
}

impl MockRepository {
    fn new() -> Self {
        Self {
            muted_users: HashSet::new(),
            unsubscribed_users: HashSet::new(),
            created_notifications: Mutex::new(Vec::new()),
        }
    }

    fn with_muted_user(mut self, user_id: MacroUserIdStr<'static>) -> Self {
        self.muted_users.insert(user_id);
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
        _recipient_ids: &[MacroUserIdStr<'a>],
    ) -> Result<Option<Uuid>, Report> {
        self.created_notifications
            .lock()
            .unwrap()
            .push(notification_id);
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
        Ok(HashMap::new())
    }

    async fn delete_notifications<'a>(
        &self,
        _criteria: &RevokeCriteria<'a>,
    ) -> Result<u64, Report> {
        Ok(0)
    }
}

/// Mock queue that tracks published messages.
struct MockQueue {
    published: Mutex<Vec<String>>,
}

impl MockQueue {
    fn new() -> Self {
        Self {
            published: Mutex::new(Vec::new()),
        }
    }
}

impl NotificationQueue for MockQueue {
    async fn publish<T: serde::Serialize + Send + Sync>(
        &self,
        messages: &[QueueMessage<'_, T>],
    ) -> Result<(), Report> {
        let mut published = self.published.lock().unwrap();
        for message in messages {
            published.push(message.message_type.clone());
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
        recipient_ids: vec![recipient.clone()],
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
        recipient_ids: vec![sender.clone()],
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
        recipient_ids: vec![muted_user],
    }
    .into_request();

    let result = service.send_notification(request).await.unwrap();

    // Muted user should be excluded, no valid recipients remain
    assert!(result.is_none());
}
