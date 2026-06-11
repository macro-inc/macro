use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use aws_sdk_sns::types::MessageAttributeValue;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde::Serialize;

use crate::domain::models::apple::VoipPushPayload;
use crate::domain::models::mobile::{DeviceEndpoint, SnsTarget};
use crate::domain::ports::{NotificationRepository, VoipPushSender};
use crate::outbound::mobile::{MobilePushAdapter, MobilePushOps};

use super::VoipPushServiceImpl;

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn user(email: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

fn payload() -> VoipPushPayload {
    VoipPushPayload {
        aps: Default::default(),
        call_id: "11111111-1111-1111-1111-111111111111".to_string(),
        channel_id: "ch-1".to_string(),
        channel_name: "general".to_string(),
        caller_name: "Alice".to_string(),
        livekit_server_url: Some("wss://livekit.example".to_string()),
        livekit_token: Some("test-token".to_string()),
        ring_status_url: Some(
            "https://api.example/call/ring-status/11111111-1111-1111-1111-111111111111".to_string(),
        ),
    }
}

// ─── Mock: NotificationRepository ────────────────────────────────────────────

struct MockRepo {
    endpoints: Result<HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>, &'static str>,
}

impl MockRepo {
    fn with_endpoints(map: HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>) -> Self {
        Self { endpoints: Ok(map) }
    }

    fn failing() -> Self {
        Self {
            endpoints: Err("db error"),
        }
    }
}

impl NotificationRepository for MockRepo {
    async fn get_device_endpoints<'a>(
        &self,
        _: &[MacroUserIdStr<'a>],
    ) -> Result<HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>, Report> {
        self.endpoints
            .clone()
            .map_err(|e| rootcause::report!("{e}"))
    }

    async fn get_device_endpoint(&self, _: &str) -> Result<Option<String>, Report> {
        unimplemented!()
    }
    async fn upsert_device(
        &self,
        _: MacroUserIdStr<'_>,
        _: &str,
        _: &str,
        _: &crate::domain::models::device::DeviceType,
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn delete_device_by_token(
        &self,
        _: &str,
        _: &crate::domain::models::device::DeviceType,
    ) -> Result<String, Report> {
        unimplemented!()
    }
    async fn delete_device_by_endpoint(&self, _: &str) -> Result<(), Report> {
        unimplemented!()
    }
    async fn get_muted_users<'a>(
        &self,
        _: &[MacroUserIdStr<'a>],
    ) -> Result<std::collections::HashSet<MacroUserIdStr<'static>>, Report> {
        unimplemented!()
    }
    async fn get_unsubscribed_users<'a>(
        &self,
        _: &str,
        _: &[MacroUserIdStr<'a>],
    ) -> Result<std::collections::HashSet<MacroUserIdStr<'static>>, Report> {
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
        _: &[MacroUserIdStr<'a>],
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn mark_notifications_seen(
        &self,
        _: MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
    ) -> Result<
        Vec<
            crate::domain::models::PatchDelete<
                uuid::Uuid,
                crate::domain::models::NotificationStatusPatch,
            >,
        >,
        Report,
    > {
        unimplemented!()
    }
    async fn mark_notifications_done(
        &self,
        _: &MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
        _: bool,
    ) -> Result<
        Vec<
            crate::domain::models::PatchDelete<
                uuid::Uuid,
                crate::domain::models::NotificationStatusPatch,
            >,
        >,
        Report,
    > {
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
        _: MacroUserIdStr<'_>,
        _: u32,
        _: models_pagination::Query<uuid::Uuid, models_pagination::CreatedAt, ()>,
        _: crate::domain::models::request::NotificationListFilters,
    ) -> Result<Vec<crate::domain::models::UserNotificationRow<T>>, Report> {
        unimplemented!()
    }
    async fn get_user_notifications_by_event_item_ids<T: serde::de::DeserializeOwned + Send>(
        &self,
        _: MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
        _: u32,
        _: models_pagination::Query<uuid::Uuid, models_pagination::CreatedAt, ()>,
        _: crate::domain::models::request::NotificationListFilters,
    ) -> Result<Vec<crate::domain::models::UserNotificationRow<T>>, Report> {
        unimplemented!()
    }
    async fn get_user_notification_by_id<T: serde::de::DeserializeOwned + Send>(
        &self,
        _: MacroUserIdStr<'_>,
        _: uuid::Uuid,
    ) -> Result<Option<crate::domain::models::UserNotificationRow<T>>, Report> {
        unimplemented!()
    }
    async fn delete_user_notification(
        &self,
        _: MacroUserIdStr<'_>,
        _: uuid::Uuid,
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn bulk_delete_user_notifications(
        &self,
        _: MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn delete_all_user_notifications(&self, _: MacroUserIdStr<'_>) -> Result<(), Report> {
        unimplemented!()
    }
    async fn get_users_with_type_disabled<'a>(
        &self,
        _: &str,
        _: &[MacroUserIdStr<'a>],
    ) -> Result<std::collections::HashSet<MacroUserIdStr<'static>>, Report> {
        unimplemented!()
    }
    async fn get_disabled_notification_types(
        &self,
        _: MacroUserIdStr<'_>,
    ) -> Result<Vec<crate::domain::models::DisabledNotificationType>, Report> {
        unimplemented!()
    }
    async fn disable_notification_type(
        &self,
        _: MacroUserIdStr<'_>,
        _: &str,
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn enable_notification_type(&self, _: MacroUserIdStr<'_>, _: &str) -> Result<(), Report> {
        unimplemented!()
    }
}

// ─── Mock: MobilePushOps ──────────────────────────────────────────────────────

struct MockPush {
    calls: Arc<Mutex<Vec<String>>>,
    should_fail: bool,
}

impl MockPush {
    fn new(calls: Arc<Mutex<Vec<String>>>) -> Self {
        Self {
            calls,
            should_fail: false,
        }
    }

    fn failing() -> Self {
        Self {
            calls: Arc::new(Mutex::new(Vec::new())),
            should_fail: true,
        }
    }
}

impl MobilePushOps for MockPush {
    async fn push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        _: &SnsTarget<'_, T>,
        _: HashMap<String, MessageAttributeValue>,
    ) -> Result<String, Report> {
        if self.should_fail {
            return Err(rootcause::report!("SNS error"));
        }
        self.calls.lock().unwrap().push(endpoint_arn.to_string());
        Ok("msg-id".to_string())
    }
}

fn make_service(repo: MockRepo, push: MockPush) -> VoipPushServiceImpl<MockRepo, MockPush> {
    let adapter = MobilePushAdapter {
        push_service: push,
        apns_bundle_id: "com.example.app".to_string(),
        voip_bundle_id: Some("com.example.app.voip".to_string()),
    };
    VoipPushServiceImpl::new(repo, adapter)
}

fn tracked_push() -> (MockPush, Arc<Mutex<Vec<String>>>) {
    let calls = Arc::new(Mutex::new(Vec::new()));
    (MockPush::new(Arc::clone(&calls)), calls)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn dispatches_to_ios_voip_endpoint() {
    let (push, calls) = tracked_push();
    let svc = make_service(
        MockRepo::with_endpoints(HashMap::from([(
            user("alice@example.com"),
            vec![DeviceEndpoint::IosVoip("arn:voip-alice".to_string())],
        )])),
        push,
    );

    let targets = svc
        .get_voip_push_targets(&[user("alice@example.com")])
        .await
        .unwrap();
    assert_eq!(targets.len(), 1);

    let result = svc
        .send_voip_pushes(vec![(targets[0].clone(), payload())])
        .await;

    assert_eq!(*calls.lock().unwrap(), vec!["arn:voip-alice"]);
    assert_eq!(
        result,
        std::collections::HashSet::from([user("alice@example.com")])
    );
}

#[tokio::test]
async fn skips_non_voip_endpoints() {
    let (push, calls) = tracked_push();
    let svc = make_service(
        MockRepo::with_endpoints(HashMap::from([(
            user("bob@example.com"),
            vec![
                DeviceEndpoint::Ios("arn:apns-bob".to_string()),
                DeviceEndpoint::Android("arn:fcm-bob".to_string()),
            ],
        )])),
        push,
    );

    let targets = svc
        .get_voip_push_targets(&[user("bob@example.com")])
        .await
        .unwrap();

    assert!(targets.is_empty());
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn repo_error_is_propagated() {
    let (push, calls) = tracked_push();
    let svc = make_service(MockRepo::failing(), push);

    let result = svc
        .get_voip_push_targets(&[user("alice@example.com")])
        .await;

    assert!(result.is_err());
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn sns_failure_does_not_panic() {
    let svc = make_service(
        MockRepo::with_endpoints(HashMap::from([(
            user("alice@example.com"),
            vec![DeviceEndpoint::IosVoip("arn:voip-alice".to_string())],
        )])),
        MockPush::failing(),
    );

    let targets = svc
        .get_voip_push_targets(&[user("alice@example.com")])
        .await
        .unwrap();
    let result = svc
        .send_voip_pushes(vec![(targets[0].clone(), payload())])
        .await;

    assert!(result.is_empty());
}
