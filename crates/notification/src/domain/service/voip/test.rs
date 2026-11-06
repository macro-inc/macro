use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use aws_sdk_sns::types::MessageAttributeValue;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde::Serialize;

use crate::domain::models::apple::VoipPushPayload;
use crate::domain::models::mobile::DeviceEndpoint;
use crate::domain::ports::{NotificationRepository, VoipPushSender};
use crate::outbound::mobile::{MobilePushAdapter, MobilePushOps, SnsTarget};

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
    async fn notification_is_withdrawn(
        &self,
        _notification_id: uuid::Uuid,
    ) -> Result<bool, Report> {
        unreachable!("this service does not deliver queued workflow notifications")
    }

    async fn complete_notification_publication(
        &self,
        _notification_id: uuid::Uuid,
    ) -> Result<(), Report> {
        unreachable!("this service does not publish notifications")
    }

    async fn get_device_endpoints<'a>(
        &self,
        _: &[MacroUserIdStr<'a>],
    ) -> Result<HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>, Report> {
        self.endpoints
            .clone()
            .map_err(|e| rootcause::report!("{e}"))
    }

    async fn get_device_endpoint(
        &self,
        _: &str,
        _: &crate::domain::models::device::DeviceType,
    ) -> Result<Option<String>, Report> {
        unimplemented!()
    }
    async fn upsert_device(
        &self,
        _: MacroUserIdStr<'_>,
        _: &str,
        _: &str,
        _: &crate::domain::models::device::DeviceType,
        _native_call_capable: bool,
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn delete_user_devices_by_token(
        &self,
        _: MacroUserIdStr<'_>,
        _: &str,
        _: &crate::domain::models::device::DeviceType,
    ) -> Result<Vec<String>, Report> {
        unimplemented!()
    }
    async fn delete_stale_devices_by_token(
        &self,
        _: &str,
        _: &crate::domain::models::device::DeviceType,
        _: &str,
    ) -> Result<Vec<String>, Report> {
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
    ) -> Result<Vec<crate::domain::models::UserNotificationRow<serde_json::Value>>, Report> {
        unimplemented!()
    }
    async fn mark_notifications_done(
        &self,
        _: &MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
        _: bool,
    ) -> Result<Vec<crate::domain::models::UserNotificationRow<serde_json::Value>>, Report> {
        unimplemented!()
    }
    async fn get_notification_ids_for_entities(
        &self,
        _: MacroUserIdStr<'_>,
        _: &[model_entity::Entity<'_>],
        _: &crate::domain::models::request::NotificationStatus,
    ) -> Result<Vec<uuid::Uuid>, Report> {
        unimplemented!()
    }
    async fn get_basic_notifications(
        &self,
        _: &[uuid::Uuid],
    ) -> Result<Vec<crate::domain::models::NotificationIdAndCollapseKey>, Report> {
        unimplemented!()
    }
    async fn get_digest_eligible_notification_ids(
        &self,
        _: MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
    ) -> Result<HashSet<uuid::Uuid>, Report> {
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
    async fn get_entity_notifications_batch(
        &self,
        _: MacroUserIdStr<'_>,
        entity_refs: Vec<model_entity::Entity<'static>>,
        _query: crate::domain::models::entity_query::EntityNotificationQuery,
    ) -> Result<
        std::collections::HashMap<
            model_entity::Entity<'static>,
            Vec<crate::domain::models::UserNotificationRow<serde_json::Value>>,
        >,
        Report,
    > {
        Ok(entity_refs
            .into_iter()
            .map(|entity_ref| (entity_ref, Vec::new()))
            .collect())
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
    failing_endpoints: HashSet<String>,
}

impl MockPush {
    fn new(calls: Arc<Mutex<Vec<String>>>) -> Self {
        Self {
            calls,
            should_fail: false,
            failing_endpoints: HashSet::new(),
        }
    }

    fn failing() -> Self {
        Self {
            calls: Arc::new(Mutex::new(Vec::new())),
            should_fail: true,
            failing_endpoints: HashSet::new(),
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
        if self.should_fail || self.failing_endpoints.contains(endpoint_arn) {
            return Err(rootcause::report!("SNS error"));
        }
        self.calls.lock().unwrap().push(endpoint_arn.to_string());
        Ok("msg-id".to_string())
    }
}

fn make_service(
    repo: MockRepo,
    push: MockPush,
) -> VoipPushServiceImpl<MockRepo, MobilePushAdapter<MockPush>> {
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
        result.fully_delivered,
        std::collections::HashSet::from([user("alice@example.com")])
    );
}

#[tokio::test]
async fn targets_android_calls_but_skips_regular_ios_endpoints() {
    let (push, calls) = tracked_push();
    let svc = make_service(
        MockRepo::with_endpoints(HashMap::from([(
            user("bob@example.com"),
            vec![
                DeviceEndpoint::Ios("arn:apns-bob".to_string()),
                DeviceEndpoint::AndroidNativeCall(
                    "arn:aws:sns:us-east-1:123:endpoint/GCM/macro/bob".to_string(),
                ),
            ],
        )])),
        push,
    );

    let targets = svc
        .get_voip_push_targets(&[user("bob@example.com")])
        .await
        .unwrap();

    assert_eq!(targets.len(), 1);
    assert!(matches!(
        targets[0].endpoints.as_slice(),
        [DeviceEndpoint::Ios(_), DeviceEndpoint::AndroidNativeCall(arn)] if arn == "arn:aws:sns:us-east-1:123:endpoint/GCM/macro/bob"
    ));
    let delivered = svc
        .send_voip_pushes(vec![(targets[0].clone(), payload())])
        .await;
    // Android delivery cannot replace the ordinary iOS alert on another device.
    assert!(delivered.fully_delivered.is_empty());
    assert!(delivered.delivered.ios.is_empty());
    assert_eq!(
        delivered.delivered.android,
        HashSet::from([user("bob@example.com")])
    );
    assert_eq!(calls.lock().unwrap().len(), 1);
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

    assert_eq!(
        result,
        crate::domain::models::NativeCallPushResult::default()
    );
}

#[tokio::test]
async fn android_delivery_does_not_suppress_apns_when_ios_voip_fails() {
    let (mut push, calls) = tracked_push();
    push.failing_endpoints.insert("arn:voip-bob".to_string());
    let svc = make_service(
        MockRepo::with_endpoints(HashMap::from([(
            user("bob@example.com"),
            vec![
                DeviceEndpoint::Ios("arn:apns-bob".to_string()),
                DeviceEndpoint::IosVoip("arn:voip-bob".to_string()),
                DeviceEndpoint::AndroidNativeCall(
                    "arn:aws:sns:us-east-1:123:endpoint/GCM/macro/bob".to_string(),
                ),
            ],
        )])),
        push,
    );

    let targets = svc
        .get_voip_push_targets(&[user("bob@example.com")])
        .await
        .unwrap();
    let suppress_apns = svc
        .send_voip_pushes(vec![(targets[0].clone(), payload())])
        .await;

    assert!(suppress_apns.fully_delivered.is_empty());
    assert!(suppress_apns.delivered.ios.is_empty());
    assert_eq!(
        suppress_apns.delivered.android,
        HashSet::from([user("bob@example.com")])
    );
    assert_eq!(
        *calls.lock().unwrap(),
        vec!["arn:aws:sns:us-east-1:123:endpoint/GCM/macro/bob"]
    );
}

#[tokio::test]
async fn successful_ios_voip_delivery_suppresses_apns_when_android_fails() {
    let (mut push, calls) = tracked_push();
    push.failing_endpoints
        .insert("arn:aws:sns:us-east-1:123:endpoint/GCM/macro/bob".to_string());
    let svc = make_service(
        MockRepo::with_endpoints(HashMap::from([(
            user("bob@example.com"),
            vec![
                DeviceEndpoint::IosVoip("arn:voip-bob".to_string()),
                DeviceEndpoint::AndroidNativeCall(
                    "arn:aws:sns:us-east-1:123:endpoint/GCM/macro/bob".to_string(),
                ),
            ],
        )])),
        push,
    );

    let targets = svc
        .get_voip_push_targets(&[user("bob@example.com")])
        .await
        .unwrap();
    let suppress_apns = svc
        .send_voip_pushes(vec![(targets[0].clone(), payload())])
        .await;

    assert!(suppress_apns.fully_delivered.is_empty());
    assert!(suppress_apns.delivered.android.is_empty());
    assert_eq!(
        suppress_apns.delivered.ios,
        HashSet::from([user("bob@example.com")])
    );
    assert_eq!(*calls.lock().unwrap(), vec!["arn:voip-bob"]);
}

#[tokio::test]
async fn successful_native_delivery_on_all_registered_platforms_needs_no_fallback_row() {
    for endpoints in [
        vec![DeviceEndpoint::AndroidNativeCall(
            "arn:aws:sns:us-east-1:123:endpoint/GCM/macro/bob".into(),
        )],
        vec![
            DeviceEndpoint::Ios("arn:apns-bob".into()),
            DeviceEndpoint::IosVoip("arn:voip-bob".into()),
        ],
        vec![
            DeviceEndpoint::Ios("arn:apns-bob".into()),
            DeviceEndpoint::IosVoip("arn:voip-bob".into()),
            DeviceEndpoint::AndroidNativeCall(
                "arn:aws:sns:us-east-1:123:endpoint/GCM/macro/bob".into(),
            ),
        ],
    ] {
        let (push, _) = tracked_push();
        let svc = make_service(
            MockRepo::with_endpoints(HashMap::from([(user("bob@example.com"), endpoints)])),
            push,
        );
        let targets = svc
            .get_voip_push_targets(&[user("bob@example.com")])
            .await
            .unwrap();
        let result = svc
            .send_voip_pushes(vec![(targets[0].clone(), payload())])
            .await;
        assert_eq!(
            result.fully_delivered,
            HashSet::from([user("bob@example.com")])
        );
    }
}

#[tokio::test]
async fn ordinary_ios_only_users_do_not_need_native_call_tokens() {
    let (push, calls) = tracked_push();
    let svc = make_service(
        MockRepo::with_endpoints(HashMap::from([(
            user("bob@example.com"),
            vec![DeviceEndpoint::Ios("arn:apns-bob".into())],
        )])),
        push,
    );
    assert!(
        svc.get_voip_push_targets(&[user("bob@example.com")])
            .await
            .unwrap()
            .is_empty()
    );
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn legacy_android_devices_are_not_native_call_targets() {
    let (push, calls) = tracked_push();
    let svc = make_service(
        MockRepo::with_endpoints(HashMap::from([(
            user("bob@example.com"),
            vec![DeviceEndpoint::Android("legacy-android".into())],
        )])),
        push,
    );
    assert!(
        svc.get_voip_push_targets(&[user("bob@example.com")])
            .await
            .unwrap()
            .is_empty()
    );
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn native_android_success_keeps_legacy_android_fallback_on_the_same_account() {
    let (push, calls) = tracked_push();
    let svc = make_service(
        MockRepo::with_endpoints(HashMap::from([(
            user("bob@example.com"),
            vec![
                DeviceEndpoint::Android("legacy-android".into()),
                DeviceEndpoint::AndroidNativeCall(
                    "arn:aws:sns:us-east-1:123:endpoint/GCM/macro/bob".into(),
                ),
                DeviceEndpoint::IosVoip("arn:voip-bob".into()),
            ],
        )])),
        push,
    );
    let targets = svc
        .get_voip_push_targets(&[user("bob@example.com")])
        .await
        .unwrap();
    let result = svc
        .send_voip_pushes(vec![(targets[0].clone(), payload())])
        .await;
    assert!(result.fully_delivered.is_empty());
    assert!(result.delivered.android.contains(&user("bob@example.com")));
    assert!(result.delivered.ios.contains(&user("bob@example.com")));
    assert_eq!(calls.lock().unwrap().len(), 2);
    assert!(
        !calls
            .lock()
            .unwrap()
            .iter()
            .any(|arn| arn == "legacy-android")
    );
}
