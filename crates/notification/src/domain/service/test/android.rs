use super::*;
use crate::domain::models::android::FCMMessage;
use crate::domain::models::email_notification_digest::ports::NotificationSendChecker;
use crate::domain::models::email_notification_digest::{
    BatchSend, BulkDigestEgressStateMachine, DontSend, ResumeMachineBRequest,
};
use crate::domain::models::mobile::MessageAttributes;
use crate::domain::models::queue_message::DeliverySuccess;

#[tokio::test]
async fn queues_android_and_ios_together_after_recipient_filtering() {
    let user = test_user_id("alice@example.com");
    let muted = test_user_id("muted@example.com");
    let queue = Arc::new(MockQueue::new());
    let repo = Arc::new(
        MockRepository::new()
            .with_device_endpoint(user.clone(), DeviceEndpoint::Ios("ios".into()))
            .with_device_endpoint(user.clone(), DeviceEndpoint::Android("android".into()))
            .with_device_endpoint(user.clone(), DeviceEndpoint::IosVoip("voip".into()))
            .with_device_endpoint(muted.clone(), DeviceEndpoint::Android("muted".into()))
            .with_muted_user(muted.clone()),
    );
    let service = NotificationIngressService::new(repo.clone(), queue.clone(), MockStateMachine);
    service
        .send_notification(
            SendNotificationRequestBuilder {
                notification_entity: EntityType::Document.with_entity_str("doc"),
                secondary_notification_entity: None,
                notification: TestNotification {
                    message: "Hello".into(),
                },
                sender_id: None,
                recipient_ids: HashSet::from([user.clone(), muted]),
            }
            .into_request()
            .with_apns(),
        )
        .await
        .unwrap();
    let published = queue.get_published();
    assert_eq!(published.len(), 1);
    let recipients = published[0]["content"]["Ios"]["ios_device_endpoints"]
        .as_object()
        .unwrap();
    assert_eq!(recipients.len(), 1);
    assert_eq!(recipients[user.as_ref()]["endpoints"], json!(["ios"]));
    assert_eq!(
        recipients[user.as_ref()]["android_endpoints"],
        json!(["android"])
    );
    assert!(repo.stored_collapse_keys.lock().unwrap()[0].1.is_some());
}

#[tokio::test]
async fn android_only_alerts_keep_the_identifier_needed_for_clearing() {
    let user = test_user_id("alice@example.com");
    let repo = Arc::new(
        MockRepository::new()
            .with_device_endpoint(user.clone(), DeviceEndpoint::Android("android".into())),
    );
    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(repo.clone(), queue.clone(), MockStateMachine);
    service
        .send_notification(
            SendNotificationRequestBuilder {
                notification_entity: EntityType::Document.with_entity_str("doc"),
                secondary_notification_entity: None,
                notification: TestNotification {
                    message: "Hello".into(),
                },
                sender_id: None,
                recipient_ids: HashSet::from([user]),
            }
            .into_request()
            .with_apns(),
        )
        .await
        .unwrap();
    assert_eq!(queue.get_published().len(), 1);
    assert!(repo.stored_collapse_keys.lock().unwrap()[0].1.is_some());
}

#[derive(Default)]
struct CaptureMobile {
    android: Mutex<Vec<(String, serde_json::Value)>>,
    ios: Mutex<Vec<String>>,
}

#[derive(Default)]
struct CaptureFallback {
    groups: Mutex<Vec<usize>>,
    fallback_queued: Mutex<bool>,
}

impl BulkDigestEgressStateMachine for CaptureFallback {
    async fn continue_machine<N: NotificationSendChecker>(
        &self,
        req: ResumeMachineBRequest<N>,
    ) -> (
        Vec<Result<N::Ok, N::Err>>,
        either::Either<DontSend, Result<BatchSend<()>, Report>>,
    ) {
        self.groups.lock().unwrap().push(req.send_notifs.len());
        let result = MockEgressStateMachine.continue_machine(req).await;
        *self.fallback_queued.lock().unwrap() = result.1.is_right();
        result
    }
}

impl NotificationSender for CaptureMobile {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint: &str,
        _: &APNSPushNotification<T>,
        _: &MessageAttributes,
    ) -> Result<String, Report> {
        self.ios.lock().unwrap().push(endpoint.to_owned());
        rootcause::bail!("simulated iOS failure")
    }

    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint: &str,
        notification: &FCMMessage<T>,
        _: &MessageAttributes,
    ) -> Result<String, Report> {
        self.android
            .lock()
            .unwrap()
            .push((endpoint.into(), serde_json::to_value(notification).unwrap()));
        Ok("android-message-id".into())
    }
}

#[tokio::test]
async fn delivers_android_even_when_the_same_users_ios_endpoint_fails() {
    let queue = Arc::new(MockQueue::new());
    let user = test_user_id("alice@example.com");
    let ingress = NotificationIngressService::new(
        MockRepository::new()
            .with_device_endpoint(user.clone(), DeviceEndpoint::Ios("ios".into()))
            .with_device_endpoint(user.clone(), DeviceEndpoint::Android("android".into())),
        queue.clone(),
        MockStateMachine,
    );
    ingress
        .send_notification(
            SendNotificationRequestBuilder {
                notification_entity: EntityType::Document.with_entity_str("doc"),
                secondary_notification_entity: None,
                notification: TestNotification {
                    message: "Hello".into(),
                },
                sender_id: None,
                recipient_ids: HashSet::from([user.clone()]),
            }
            .into_request()
            .with_apns(),
        )
        .await
        .unwrap();
    let egress = NotificationEgressService {
        queue: MockQueue::new(),
        repository: MockRepository::new(),
        realtime: MockRealtimeSender,
        mobile: CaptureMobile::default(),
        email: MockEmailSender,
        rate_limiter: allowing_rate_limiter(),
        state_machine: CaptureFallback::default(),
        digest_batcher: MockDigestBatcher,
    };
    let mut queued = queue.get_published().remove(0);
    queued["content"]["Ios"]["ios_device_endpoints"][user.as_ref()]["digest_state"] = json!({
        "inner": updated_notification(user.clone(), Uuid::now_v7(), false, None, Utc::now())
    });
    let message = serde_json::from_value(queued).unwrap();
    let results = egress.deliver_notification(message).await;
    assert_eq!(results.len(), 2);
    assert!(
        results
            .iter()
            .any(|result| matches!(result, Ok(DeliverySuccess::Android)))
    );
    assert!(results.iter().any(Result::is_err));
    let android = egress.mobile.android.lock().unwrap();
    assert_eq!(android.len(), 1);
    assert_eq!(android[0].0, "android");
    assert_eq!(android[0].1["data"]["message"], "Hello");
    assert_eq!(egress.mobile.ios.lock().unwrap().as_slice(), ["ios"]);
    assert_eq!(egress.state_machine.groups.lock().unwrap().as_slice(), [2]);
    assert!(!*egress.state_machine.fallback_queued.lock().unwrap());
}

#[tokio::test]
async fn seen_and_done_deliver_silent_clear_to_android_only_users() {
    for status in [NotificationStatus::Seen, NotificationStatus::Done(true)] {
        let user = test_user_id("alice@example.com");
        let id = Uuid::now_v7();
        let queue = Arc::new(MockQueue::new());
        let reader = NotificationReaderService {
            repository: MockRepository::new()
                .with_basic_notification(id, "identifier".into())
                .with_device_endpoint(user.clone(), DeviceEndpoint::Android("android".into())),
            queue: queue.clone(),
            sns_endpoint: MockSnsEndpoint,
            platform_config: test_platform_config(),
            realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
        };
        reader
            .update_notifications(UpdateNotificationsRequest {
                user_id: user,
                notification_ids: &[id],
                status,
            })
            .await
            .unwrap();
        let mut messages = queue.get_published();
        assert_eq!(messages.len(), 1);
        let egress = NotificationEgressService {
            queue: MockQueue::new(),
            repository: MockRepository::new(),
            realtime: MockRealtimeSender,
            mobile: CaptureMobile::default(),
            email: MockEmailSender,
            rate_limiter: allowing_rate_limiter(),
            state_machine: MockEgressStateMachine,
            digest_batcher: MockDigestBatcher,
        };
        let results = egress
            .deliver_notification(serde_json::from_value(messages.remove(0)).unwrap())
            .await;
        assert!(matches!(results.as_slice(), [Ok(DeliverySuccess::Android)]));
        let android = egress.mobile.android.lock().unwrap();
        assert_eq!(android[0].1["identifier"], "identifier");
        assert!(android[0].1["title"].is_null());
        assert!(android[0].1["body"].is_null());
    }
}
