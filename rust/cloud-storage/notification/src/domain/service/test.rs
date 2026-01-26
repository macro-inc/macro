//! Unit tests for the NotificationService.

use crate::domain::models::android::FCMMessage;
use crate::domain::models::apple::APNSPushNotification;
use crate::domain::models::mobile::MessageAttributes;
use crate::domain::models::{
    DeviceEndpoint, Notification, RateLimitConfig, RateLimitKey, RateLimitResult, RevokeCriteria,
    SendNotificationRequest,
};
use crate::domain::ports::{
    EmailSender, NotificationRepository, NotificationSender, RateLimitPort, WebSocketSender,
};
use crate::domain::service::{NotificationService, SendNotificationError};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
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
}

/// Helper to create a test user ID.
fn test_user_id(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

/// Mock rate limiter that allows configuration of behavior.
struct MockRateLimiter {
    allow: bool,
    current_count: AtomicU64,
}

impl MockRateLimiter {
    fn new_allowing() -> Self {
        Self {
            allow: true,
            current_count: AtomicU64::new(0),
        }
    }

    fn new_exceeded() -> Self {
        Self {
            allow: false,
            current_count: AtomicU64::new(100),
        }
    }
}

impl RateLimitPort for MockRateLimiter {
    async fn check_and_increment(
        &self,
        _key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        if self.allow {
            let count = self.current_count.fetch_add(1, Ordering::SeqCst) + 1;
            Ok(RateLimitResult::Allowed {
                current_count: count,
            })
        } else {
            Ok(RateLimitResult::Exceeded {
                current_count: self.current_count.load(Ordering::SeqCst),
                max_count: config.max_count,
            })
        }
    }
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
        _request: &SendNotificationRequest<'a, T>,
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

/// Mock WebSocket sender that tracks which users were "delivered" to.
struct MockWebSocketSender {
    online_users: HashSet<MacroUserIdStr<'static>>,
}

impl MockWebSocketSender {
    fn new() -> Self {
        Self {
            online_users: HashSet::new(),
        }
    }

    fn with_online_user(mut self, user_id: MacroUserIdStr<'static>) -> Self {
        self.online_users.insert(user_id);
        self
    }
}

impl WebSocketSender for MockWebSocketSender {
    async fn send_notifications<'a, T: Notification + Send + Sync>(
        &self,
        notifications: Vec<(MacroUserIdStr<'a>, &T)>,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        let delivered: HashSet<_> = notifications
            .into_iter()
            .filter_map(|(user_id, _)| {
                let static_id: MacroUserIdStr<'static> = user_id.into_owned();
                if self.online_users.contains(&static_id) {
                    Some(static_id)
                } else {
                    None
                }
            })
            .collect();
        Ok(delivered)
    }
}

/// Mock mobile push sender.
struct MockMobileSender;

impl NotificationSender for MockMobileSender {
    async fn send_ios_push_notification<T: Send>(
        &self,
        _notification: APNSPushNotification<T>,
        _attributes: MessageAttributes,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn send_android_push_notification<T: Send>(
        &self,
        _notification: FCMMessage<T>,
        _attributes: MessageAttributes,
    ) -> Result<(), Report> {
        Ok(())
    }
}

/// Mock email sender.
struct MockEmailSender;

impl EmailSender for MockEmailSender {
    async fn send_email<T: Notification + Send + Sync>(
        &self,
        _notification: &T,
        _recipient: MacroUserIdStr<'_>,
    ) -> Result<(), Report> {
        Ok(())
    }
}

fn create_service<R, N, W>(
    rate_limiter: R,
    repository: N,
    websocket: W,
) -> NotificationService<R, N, W, MockMobileSender, MockEmailSender>
where
    R: RateLimitPort,
    N: NotificationRepository,
    W: WebSocketSender,
{
    NotificationService::new(
        rate_limiter,
        repository,
        websocket,
        MockMobileSender,
        MockEmailSender,
        "test_service",
    )
}

#[tokio::test]
async fn test_send_notification_success() {
    let service = create_service(
        MockRateLimiter::new_allowing(),
        MockRepository::new(),
        MockWebSocketSender::new(),
    );

    let recipient = test_user_id("user@example.com");
    let request = SendNotificationRequest {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: vec![recipient.clone()],
    };

    let result = service.send_notification(request, None).await.unwrap();

    assert!(result.notified_recipients.contains(&recipient));
}

#[tokio::test]
async fn test_send_notification_rate_limited() {
    let service = create_service(
        MockRateLimiter::new_exceeded(),
        MockRepository::new(),
        MockWebSocketSender::new(),
    );

    let recipient = test_user_id("user@example.com");
    let request = SendNotificationRequest {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: vec![recipient],
    };

    let rate_limit_key = RateLimitKey::new(vec![1, 2, 3]);
    let rate_limit_config = RateLimitConfig {
        max_count: 10,
        window: Duration::from_secs(60),
    };

    let result = service
        .send_notification(request, Some((rate_limit_key, rate_limit_config)))
        .await;

    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(matches!(
        err.current_context(),
        SendNotificationError::RateLimitExceeded
    ));
}

#[tokio::test]
async fn test_sender_excluded_from_recipients() {
    let service = create_service(
        MockRateLimiter::new_allowing(),
        MockRepository::new(),
        MockWebSocketSender::new(),
    );

    let sender = test_user_id("sender@example.com");
    let request = SendNotificationRequest {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: Some(sender.clone()),
        recipient_ids: vec![sender.clone()],
    };

    let result = service.send_notification(request, None).await.unwrap();

    // Sender should be excluded
    assert!(result.notified_recipients.is_empty());
}

#[tokio::test]
async fn test_muted_user_excluded() {
    let muted_user = test_user_id("muted@example.com");
    let service = create_service(
        MockRateLimiter::new_allowing(),
        MockRepository::new().with_muted_user(muted_user.clone()),
        MockWebSocketSender::new(),
    );

    let request = SendNotificationRequest {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: vec![muted_user],
    };

    let result = service.send_notification(request, None).await.unwrap();

    assert!(result.notified_recipients.is_empty());
}

#[tokio::test]
async fn test_websocket_delivery_tracked() {
    let online_user = test_user_id("online@example.com");
    let offline_user = test_user_id("offline@example.com");

    let service = create_service(
        MockRateLimiter::new_allowing(),
        MockRepository::new(),
        MockWebSocketSender::new().with_online_user(online_user.clone()),
    );

    let request = SendNotificationRequest {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: vec![online_user.clone(), offline_user.clone()],
    };

    let result = service.send_notification(request, None).await.unwrap();

    assert!(
        result
            .delivery_status
            .websocket_delivered
            .contains(&online_user)
    );
    assert!(
        !result
            .delivery_status
            .websocket_delivered
            .contains(&offline_user)
    );
}
