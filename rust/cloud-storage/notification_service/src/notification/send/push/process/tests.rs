use super::*;
use model_entity::EntityType;
use model_notifications::{
    ChannelMessageSendMetadata, ChannelType, CommonChannelMetadata, NotificationEvent,
    NotificationTemporalData, NotificationWithRecipient, UserNotification,
};
use notification_db_client::notification::get::DbBasicNotification;
use std::sync::atomic::{AtomicUsize, Ordering};

struct MockNotifRepo {
    update_count: AtomicUsize,
}

impl MockNotifRepo {
    fn new() -> Self {
        Self {
            update_count: AtomicUsize::new(0),
        }
    }
}

impl BasicNotificationRepo for MockNotifRepo {
    async fn update_collapse_key(
        &self,
        _notification_id: &Uuid,
        collapse_key: &str,
    ) -> anyhow::Result<DbBasicNotification<String>> {
        self.update_count.fetch_add(1, Ordering::SeqCst);
        Ok(DbBasicNotification {
            event_item_id: "test_entity_id".to_string(),
            event_item_type: "channel".to_string(),
            notification_event_type: "channel_message_send".to_string(),
            apns_collapse_key: collapse_key.to_string(),
        })
    }

    async fn get_basic_notification(
        &self,
        _notification_id: &Uuid,
    ) -> anyhow::Result<DbBasicNotification<Option<String>>> {
        Ok(DbBasicNotification {
            event_item_id: "test_entity_id".to_string(),
            event_item_type: "channel".to_string(),
            notification_event_type: "channel_message_send".to_string(),
            apns_collapse_key: None,
        })
    }
}

struct MockSnsClient {
    push_count: AtomicUsize,
    should_fail: bool,
}

impl MockSnsClient {
    fn new() -> Self {
        Self {
            push_count: AtomicUsize::new(0),
            should_fail: false,
        }
    }

    fn failing() -> Self {
        Self {
            push_count: AtomicUsize::new(0),
            should_fail: true,
        }
    }
}

impl NotificationSender for MockSnsClient {
    async fn push_notification<T>(
        &self,
        _endpoint_arn: &str,
        _message_json: &SnsTarget<T>,
        _message_attributes: MessageAttributes,
    ) -> anyhow::Result<aws_sdk_sns::operation::publish::PublishOutput>
    where
        T: serde::Serialize + std::fmt::Debug + Sync,
    {
        if self.should_fail {
            return Err(anyhow::anyhow!("mock sns failure"));
        }
        self.push_count.fetch_add(1, Ordering::SeqCst);
        Ok(aws_sdk_sns::operation::publish::PublishOutput::builder()
            .message_id("mock_message_id")
            .build())
    }
}

fn make_user_id(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).expect("valid test email")
}

fn create_test_notification(
    id: Uuid,
    recipient_email: &str,
    message_id: &str,
) -> NotificationWithRecipient {
    let sender = make_user_id("sender@example.com");
    NotificationWithRecipient {
        inner: UserNotification {
            id,
            notification_entity: EntityType::Channel
                .with_entity_string("test_channel_id".to_string()),
            sent: false,
            done: false,
            sender_id: Some(sender.clone()),
            temporal: NotificationTemporalData::default(),
            notification_event: NotificationEvent::ChannelMessageSend(ChannelMessageSendMetadata {
                sender,
                message_content: "Hello, world!".to_string(),
                message_id: message_id.to_string(),
                common: CommonChannelMetadata {
                    channel_type: ChannelType::Public,
                    channel_name: "general".to_string(),
                },
            }),
        },
        recipient_id: make_user_id(recipient_email),
    }
}

#[tokio::test]
async fn test_process_push_notifications_inner_no_devices() {
    let user_id = make_user_id("user1@example.com");
    let notif = create_test_notification(Uuid::new_v4(), "user1@example.com", "msg_1");

    let mut notifications = HashMap::new();
    notifications.insert(user_id, vec![notif]);

    // Empty device endpoints - no devices registered
    let user_device_endpoints: HashMap<MacroUserIdStr<'static>, Vec<(String, DeviceType)>> =
        HashMap::new();

    let result = process_push_notifications_inner(
        user_device_endpoints,
        &notifications,
        Arc::new(MockSnsClient::new()),
        MockNotifRepo::new(),
    )
    .await;

    assert!(result.is_ok());
    let users_sent = result.unwrap();
    // No users should have been sent push notifications since no devices registered
    assert!(users_sent.is_empty());
}

#[tokio::test]
async fn test_process_push_notifications_inner_with_ios_device() {
    let user_id = make_user_id("user1@example.com");
    let notif = create_test_notification(Uuid::new_v4(), "user1@example.com", "msg_1");

    let mut notifications = HashMap::new();
    notifications.insert(user_id.clone(), vec![notif]);

    let mut user_device_endpoints = HashMap::new();
    user_device_endpoints.insert(
        user_id.clone(),
        vec![(
            "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device".to_string(),
            DeviceType::Ios,
        )],
    );

    let sns_client = Arc::new(MockSnsClient::new());
    let notif_repo = MockNotifRepo::new();

    let result = process_push_notifications_inner(
        user_device_endpoints,
        &notifications,
        sns_client.clone(),
        notif_repo,
    )
    .await;

    assert!(result.is_ok());
    let users_sent = result.unwrap();
    assert_eq!(users_sent.len(), 1);
    assert!(users_sent.contains(&make_user_id("user1@example.com")));
}

#[tokio::test]
async fn test_process_push_notifications_inner_android_not_implemented() {
    let user_id = make_user_id("user1@example.com");
    let notif = create_test_notification(Uuid::new_v4(), "user1@example.com", "msg_1");

    let mut notifications = HashMap::new();
    notifications.insert(user_id.clone(), vec![notif]);

    let mut user_device_endpoints = HashMap::new();
    user_device_endpoints.insert(
        user_id.clone(),
        vec![(
            "arn:aws:sns:us-east-1:123:endpoint/GCM/app/device".to_string(),
            DeviceType::Android,
        )],
    );

    let sns_client = Arc::new(MockSnsClient::new());

    let result = process_push_notifications_inner(
        user_device_endpoints,
        &notifications,
        sns_client.clone(),
        MockNotifRepo::new(),
    )
    .await;

    assert!(result.is_ok());
    let users_sent = result.unwrap();
    // Android is not implemented, so no push should be sent
    assert!(users_sent.is_empty());
}

#[tokio::test]
async fn test_process_push_notifications_inner_multiple_users() {
    let user_1 = make_user_id("user1@example.com");
    let user_2 = make_user_id("user2@example.com");
    let notif_1 = create_test_notification(Uuid::new_v4(), "user1@example.com", "msg_1");
    let notif_2 = create_test_notification(Uuid::new_v4(), "user2@example.com", "msg_2");

    let mut notifications = HashMap::new();
    notifications.insert(user_1.clone(), vec![notif_1]);
    notifications.insert(user_2.clone(), vec![notif_2]);

    let mut user_device_endpoints = HashMap::new();
    user_device_endpoints.insert(
        user_1.clone(),
        vec![(
            "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device1".to_string(),
            DeviceType::Ios,
        )],
    );
    user_device_endpoints.insert(
        user_2.clone(),
        vec![(
            "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device2".to_string(),
            DeviceType::Ios,
        )],
    );

    let sns_client = Arc::new(MockSnsClient::new());

    let result = process_push_notifications_inner(
        user_device_endpoints,
        &notifications,
        sns_client.clone(),
        MockNotifRepo::new(),
    )
    .await;

    assert!(result.is_ok());
    let users_sent = result.unwrap();
    assert_eq!(users_sent.len(), 2);
    assert!(users_sent.contains(&user_1));
    assert!(users_sent.contains(&user_2));
}

#[tokio::test]
async fn test_process_push_notifications_inner_user_with_multiple_devices() {
    let user_id = make_user_id("user1@example.com");
    let notif = create_test_notification(Uuid::new_v4(), "user1@example.com", "msg_1");

    let mut notifications = HashMap::new();
    notifications.insert(user_id.clone(), vec![notif]);

    let mut user_device_endpoints = HashMap::new();
    user_device_endpoints.insert(
        user_id.clone(),
        vec![
            (
                "arn:aws:sns:us-east-1:123:endpoint/APNS/app/iphone".to_string(),
                DeviceType::Ios,
            ),
            (
                "arn:aws:sns:us-east-1:123:endpoint/APNS/app/ipad".to_string(),
                DeviceType::Ios,
            ),
        ],
    );

    let sns_client = Arc::new(MockSnsClient::new());

    let result = process_push_notifications_inner(
        user_device_endpoints,
        &notifications,
        sns_client.clone(),
        MockNotifRepo::new(),
    )
    .await;

    assert!(result.is_ok());
    let users_sent = result.unwrap();
    // User should still only appear once in the result set
    assert_eq!(users_sent.len(), 1);
    assert!(users_sent.contains(&user_id));
}

#[tokio::test]
async fn test_process_push_notifications_inner_sns_failure_skips_user() {
    let user_id = make_user_id("user1@example.com");
    let notif = create_test_notification(Uuid::new_v4(), "user1@example.com", "msg_1");

    let mut notifications = HashMap::new();
    notifications.insert(user_id.clone(), vec![notif]);

    let mut user_device_endpoints = HashMap::new();
    user_device_endpoints.insert(
        user_id.clone(),
        vec![(
            "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device".to_string(),
            DeviceType::Ios,
        )],
    );

    let sns_client = Arc::new(MockSnsClient::failing());

    let result = process_push_notifications_inner(
        user_device_endpoints,
        &notifications,
        sns_client,
        MockNotifRepo::new(),
    )
    .await;

    assert!(result.is_ok());
    let users_sent = result.unwrap();
    // SNS failed, so user should not be in the sent set
    assert!(users_sent.is_empty());
}

#[tokio::test]
async fn test_process_push_notifications_inner_empty_notifications() {
    let notifications: HashMap<MacroUserIdStr<'static>, Vec<NotificationWithRecipient>> =
        HashMap::new();
    let user_device_endpoints: HashMap<MacroUserIdStr<'static>, Vec<(String, DeviceType)>> =
        HashMap::new();

    let result = process_push_notifications_inner(
        user_device_endpoints,
        &notifications,
        Arc::new(MockSnsClient::new()),
        MockNotifRepo::new(),
    )
    .await;

    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
}

#[tokio::test]
async fn test_process_push_notifications_inner_notification_without_matching_device() {
    let user_1 = make_user_id("user1@example.com");
    let user_2 = make_user_id("user2@example.com");
    let notif = create_test_notification(Uuid::new_v4(), "user1@example.com", "msg_1");

    let mut notifications = HashMap::new();
    notifications.insert(user_1.clone(), vec![notif]);

    // Device endpoints only for user_2, not user_1
    let mut user_device_endpoints = HashMap::new();
    user_device_endpoints.insert(
        user_2.clone(),
        vec![(
            "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device".to_string(),
            DeviceType::Ios,
        )],
    );

    let result = process_push_notifications_inner(
        user_device_endpoints,
        &notifications,
        Arc::new(MockSnsClient::new()),
        MockNotifRepo::new(),
    )
    .await;

    assert!(result.is_ok());
    let users_sent = result.unwrap();
    // user_1 has notification but no device, user_2 has device but no notification
    assert!(users_sent.is_empty());
}
