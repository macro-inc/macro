use crate::domain::models::device::DeviceType;
use crate::domain::models::queue_message::QueueMessage;
use crate::domain::ports::{NotificationQueue, NotificationRepository, SnsEndpointManager};
use crate::domain::service::NotificationReader;
use crate::domain::service::ingress::{NotificationReaderService, PlatformArnConfig};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;

fn test_user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("test@example.com").unwrap()
}

// ─── Mocks ───────────────────────────────────────────────────────────────

/// Mock NotificationRepository that only implements device-related methods.
struct MockNotifRepo {
    existing_endpoint: Mutex<Option<String>>,
    upserted: Mutex<Vec<(String, String, String, String)>>,
    deleted_token_result: Mutex<Result<String, &'static str>>,
}

impl MockNotifRepo {
    fn with_existing_endpoint(endpoint: &str) -> Self {
        Self {
            existing_endpoint: Mutex::new(Some(endpoint.to_string())),
            upserted: Mutex::new(Vec::new()),
            deleted_token_result: Mutex::new(Ok("arn:default".to_string())),
        }
    }

    fn empty() -> Self {
        Self {
            existing_endpoint: Mutex::new(None),
            upserted: Mutex::new(Vec::new()),
            deleted_token_result: Mutex::new(Ok("arn:default".to_string())),
        }
    }

    fn with_delete_result(mut self, result: Result<String, &'static str>) -> Self {
        self.deleted_token_result = Mutex::new(result);
        self
    }
}

impl NotificationRepository for MockNotifRepo {
    async fn get_device_endpoint(&self, _device_token: &str) -> Result<Option<String>, Report> {
        Ok(self.existing_endpoint.lock().unwrap().clone())
    }

    async fn upsert_device(
        &self,
        user_id: macro_user_id::user_id::MacroUserIdStr<'_>,
        device_token: &str,
        device_endpoint: &str,
        device_type: &DeviceType,
    ) -> Result<(), Report> {
        self.upserted.lock().unwrap().push((
            user_id.to_string(),
            device_token.to_string(),
            device_endpoint.to_string(),
            format!("{device_type:?}"),
        ));
        Ok(())
    }

    async fn delete_device_by_token(
        &self,
        _device_token: &str,
        _device_type: &DeviceType,
    ) -> Result<String, Report> {
        self.deleted_token_result
            .lock()
            .unwrap()
            .clone()
            .map_err(|e| rootcause::report!("{e}"))
    }

    async fn delete_device_by_endpoint(&self, _: &str) -> Result<(), Report> {
        unimplemented!()
    }
    async fn get_muted_users<'a>(
        &self,
        _: &[macro_user_id::user_id::MacroUserIdStr<'a>],
    ) -> Result<std::collections::HashSet<macro_user_id::user_id::MacroUserIdStr<'static>>, Report>
    {
        unimplemented!()
    }
    async fn get_unsubscribed_users<'a>(
        &self,
        _: &str,
        _: &[macro_user_id::user_id::MacroUserIdStr<'a>],
    ) -> Result<std::collections::HashSet<macro_user_id::user_id::MacroUserIdStr<'static>>, Report>
    {
        unimplemented!()
    }
    async fn create_notification<'a, T: Serialize + Send + Sync>(
        &self,
        _: crate::domain::models::SendNotificationRequestBuilder<
            'a,
            crate::domain::models::TaggedContent<T>,
        >,
        _: uuid::Uuid,
        _: &str,
        _: Option<&str>,
    ) -> Result<Option<Vec<crate::domain::models::UserNotificationRow<std::sync::Arc<T>>>>, Report>
    {
        unimplemented!()
    }
    async fn update_sent_status<'a>(
        &self,
        _: uuid::Uuid,
        _: &[macro_user_id::user_id::MacroUserIdStr<'a>],
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn get_device_endpoints<'a>(
        &self,
        _: &[macro_user_id::user_id::MacroUserIdStr<'a>],
    ) -> Result<
        std::collections::HashMap<
            macro_user_id::user_id::MacroUserIdStr<'static>,
            Vec<crate::domain::models::DeviceEndpoint>,
        >,
        Report,
    > {
        unimplemented!()
    }
    async fn mark_notifications_seen(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn mark_notifications_done(
        &self,
        _: &macro_user_id::user_id::MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
        _: bool,
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn get_basic_notifications(
        &self,
        _: &[uuid::Uuid],
    ) -> Result<Vec<crate::domain::models::NotificationIdAndCollapseKey>, Report> {
        unimplemented!()
    }
    async fn get_user_notifications<T: serde::de::DeserializeOwned + Send>(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: u32,
        _: models_pagination::Query<uuid::Uuid, models_pagination::CreatedAt, ()>,
    ) -> Result<Vec<crate::domain::models::UserNotificationRow<T>>, Report> {
        unimplemented!()
    }
    async fn get_user_notifications_by_event_item_ids<T: serde::de::DeserializeOwned + Send>(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
        _: u32,
        _: models_pagination::Query<uuid::Uuid, models_pagination::CreatedAt, ()>,
    ) -> Result<Vec<crate::domain::models::UserNotificationRow<T>>, Report> {
        unimplemented!()
    }
    async fn get_user_notification_by_id<T: serde::de::DeserializeOwned + Send>(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: uuid::Uuid,
    ) -> Result<Option<crate::domain::models::UserNotificationRow<T>>, Report> {
        unimplemented!()
    }
    async fn delete_user_notification(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: uuid::Uuid,
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn bulk_delete_user_notifications(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn delete_all_user_notifications(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn get_users_with_type_disabled<'a>(
        &self,
        _: &str,
        _: &[macro_user_id::user_id::MacroUserIdStr<'a>],
    ) -> Result<std::collections::HashSet<macro_user_id::user_id::MacroUserIdStr<'static>>, Report>
    {
        unimplemented!()
    }
    async fn get_disabled_notification_types(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Vec<crate::domain::models::DisabledNotificationType>, Report> {
        unimplemented!()
    }
    async fn disable_notification_type(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: &str,
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn enable_notification_type(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: &str,
    ) -> Result<(), Report> {
        unimplemented!()
    }
}

struct MockSnsManager {
    created_endpoint: String,
    attributes: Mutex<HashMap<String, String>>,
    set_calls: Mutex<Vec<(String, HashMap<String, String>)>>,
    deleted: Mutex<Vec<String>>,
    get_fails: bool,
    should_fail: bool,
}

impl MockSnsManager {
    fn new() -> Self {
        Self {
            created_endpoint: "arn:new-endpoint".to_string(),
            attributes: Mutex::new(HashMap::from([
                ("Enabled".to_string(), "true".to_string()),
                ("Token".to_string(), "device-token".to_string()),
            ])),
            set_calls: Mutex::new(Vec::new()),
            deleted: Mutex::new(Vec::new()),
            get_fails: false,
            should_fail: false,
        }
    }

    fn with_attributes(self, attrs: HashMap<String, String>) -> Self {
        *self.attributes.lock().unwrap() = attrs;
        self
    }

    fn with_get_fails(mut self) -> Self {
        self.get_fails = true;
        self
    }
}

impl SnsEndpointManager for MockSnsManager {
    async fn create_platform_endpoint(
        &self,
        _platform_arn: &str,
        _token: &str,
    ) -> Result<String, Report> {
        Ok(self.created_endpoint.clone())
    }

    async fn get_endpoint_attributes(
        &self,
        _endpoint_arn: &str,
    ) -> Result<HashMap<String, String>, Report> {
        if self.get_fails {
            return Err(rootcause::report!("get_endpoint_attributes failed"));
        }
        Ok(self.attributes.lock().unwrap().clone())
    }

    async fn set_endpoint_attributes(
        &self,
        endpoint_arn: &str,
        attributes: HashMap<String, String>,
    ) -> Result<(), Report> {
        self.set_calls
            .lock()
            .unwrap()
            .push((endpoint_arn.to_string(), attributes));
        Ok(())
    }

    async fn delete_endpoint(&self, endpoint_arn: &str) -> Result<(), Report> {
        if self.should_fail {
            return Err(rootcause::report!("delete_endpoint failed"));
        }
        self.deleted.lock().unwrap().push(endpoint_arn.to_string());
        Ok(())
    }
}

/// No-op mock for NotificationQueue.
struct MockQueue;

impl NotificationQueue for MockQueue {
    async fn publish<'a, T: serde::Serialize + Send + Sync, U: serde::Serialize + Send + Sync>(
        &self,
        _: Vec<QueueMessage<'a, T, U>>,
    ) -> Result<(), Report> {
        Ok(())
    }
    async fn receive_messages(
        &self,
    ) -> Result<Vec<crate::domain::models::queue_message::RawQueueMessage>, Report> {
        Ok(Vec::new())
    }
    async fn delete_message(&self, _: &str) -> Result<(), Report> {
        Ok(())
    }

    async fn delay_message(
        &self,
        _receipt_handle: &str,
        _delay: std::time::Duration,
    ) -> Result<(), Report> {
        Ok(())
    }
}

fn test_config() -> PlatformArnConfig {
    PlatformArnConfig {
        apns_platform_arn: "arn:apns".to_string(),
        fcm_platform_arn: "arn:fcm".to_string(),
    }
}

fn make_service(
    db: MockNotifRepo,
    sns: MockSnsManager,
) -> NotificationReaderService<MockNotifRepo, MockQueue, MockSnsManager> {
    NotificationReaderService::new(db, MockQueue, sns, test_config())
}

// ─── Register Tests ──────────────────────────────────────────────────────

#[tokio::test]
async fn register_existing_token_valid_endpoint() {
    let db = MockNotifRepo::with_existing_endpoint("arn:existing");
    let sns = MockSnsManager::new();
    let service = make_service(db, sns);

    service
        .register_device(
            MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap(),
            "device-token",
            &DeviceType::Ios,
        )
        .await
        .unwrap();

    let upserted = service.repository.upserted.lock().unwrap();
    assert_eq!(upserted.len(), 1);
    assert_eq!(upserted[0].2, "arn:existing");
}

#[tokio::test]
async fn register_missing_token_creates_endpoint() {
    let db = MockNotifRepo::empty();
    let sns = MockSnsManager::new();
    let service = make_service(db, sns);

    service
        .register_device(test_user_id(), "device-token", &DeviceType::Ios)
        .await
        .unwrap();

    let upserted = service.repository.upserted.lock().unwrap();
    assert_eq!(upserted.len(), 1);
    assert_eq!(upserted[0].2, "arn:new-endpoint");
}

#[tokio::test]
async fn register_get_attributes_fails_creates_new_endpoint() {
    let db = MockNotifRepo::with_existing_endpoint("arn:existing");
    let sns = MockSnsManager::new().with_get_fails();
    let service = make_service(db, sns);

    service
        .register_device(test_user_id(), "device-token", &DeviceType::Ios)
        .await
        .unwrap();

    let upserted = service.repository.upserted.lock().unwrap();
    assert_eq!(upserted[0].2, "arn:new-endpoint");
}

#[tokio::test]
async fn register_disabled_endpoint_re_enables() {
    let db = MockNotifRepo::with_existing_endpoint("arn:existing");
    let sns = MockSnsManager::new().with_attributes(HashMap::from([
        ("Enabled".to_string(), "false".to_string()),
        ("Token".to_string(), "device-token".to_string()),
    ]));
    let service = make_service(db, sns);

    service
        .register_device(test_user_id(), "device-token", &DeviceType::Ios)
        .await
        .unwrap();

    let set_calls = service.sns_endpoint.set_calls.lock().unwrap();
    assert_eq!(set_calls.len(), 1);
    assert_eq!(set_calls[0].0, "arn:existing");
    assert_eq!(set_calls[0].1.get("Enabled").unwrap(), "true");
}

#[tokio::test]
async fn register_token_mismatch_updates() {
    let db = MockNotifRepo::with_existing_endpoint("arn:existing");
    let sns = MockSnsManager::new().with_attributes(HashMap::from([
        ("Enabled".to_string(), "true".to_string()),
        ("Token".to_string(), "old-token".to_string()),
    ]));
    let service = make_service(db, sns);

    service
        .register_device(test_user_id(), "new-token", &DeviceType::Ios)
        .await
        .unwrap();

    let set_calls = service.sns_endpoint.set_calls.lock().unwrap();
    assert_eq!(set_calls.len(), 1);
    assert_eq!(set_calls[0].1.get("Token").unwrap(), "new-token");
}

#[tokio::test]
async fn register_ios_uses_apns_arn() {
    let db = MockNotifRepo::empty();
    let sns = MockSnsManager::new();
    let service = make_service(db, sns);

    service
        .register_device(test_user_id(), "token", &DeviceType::Ios)
        .await
        .unwrap();
}

#[tokio::test]
async fn register_android_uses_fcm_arn() {
    let db = MockNotifRepo::empty();
    let sns = MockSnsManager::new();
    let service = make_service(db, sns);

    service
        .register_device(test_user_id(), "token", &DeviceType::Android)
        .await
        .unwrap();
}

// ─── Unregister Tests ────────────────────────────────────────────────────

#[tokio::test]
async fn unregister_happy_path() {
    let db = MockNotifRepo::empty().with_delete_result(Ok("arn:to-delete".to_string()));
    let sns = MockSnsManager::new();
    let service = make_service(db, sns);

    service
        .unregister_device("device-token", &DeviceType::Ios)
        .await
        .unwrap();

    let deleted = service.sns_endpoint.deleted.lock().unwrap();
    assert_eq!(deleted.len(), 1);
    assert_eq!(deleted[0], "arn:to-delete");
}

#[tokio::test]
async fn unregister_db_error_propagates() {
    let db = MockNotifRepo::empty().with_delete_result(Err("device not found"));
    let sns = MockSnsManager::new();
    let service = make_service(db, sns);

    let result = service
        .unregister_device("device-token", &DeviceType::Ios)
        .await;

    assert!(result.is_err());
    // SNS delete should not have been called
    let deleted = service.sns_endpoint.deleted.lock().unwrap();
    assert!(deleted.is_empty());
}
