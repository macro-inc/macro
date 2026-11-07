use super::*;
use crate::domain::models::android::FCMMessage;
use crate::domain::models::mobile::MessageAttributes;

#[derive(Default)]
struct CaptureIos {
    payloads: Mutex<HashMap<String, serde_json::Value>>,
}

impl NotificationSender for CaptureIos {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint: &str,
        notification: &APNSPushNotification<T>,
        _: &MessageAttributes,
    ) -> Result<String, Report> {
        self.payloads.lock().unwrap().insert(
            endpoint.to_owned(),
            serde_json::to_value(notification).unwrap(),
        );
        Ok("message-id".into())
    }

    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        _: &str,
        _: &FCMMessage<T>,
        _: &MessageAttributes,
    ) -> Result<String, Report> {
        panic!("this notification only targets iOS devices")
    }
}

#[tokio::test]
async fn one_queued_push_gets_the_correct_account_for_each_ios_recipient() {
    let service = NotificationEgressService {
        queue: MockQueue::new(),
        repository: MockRepository::new(),
        realtime: MockRealtimeSender,
        mobile: CaptureIos::default(),
        email: MockEmailSender,
        rate_limiter: allowing_rate_limiter(),
        state_machine: MockEgressStateMachine,
        digest_batcher: MockDigestBatcher,
    };
    let message = serde_json::from_value(json!({
        "message_type": "channel_message_send",
        "content": {
            "Ios": {
                "notif": {
                    "aps": {"alert": "Hello"},
                    "notificationId": "019a0000-0000-7000-8000-000000000004",
                    "navigation": {
                        "type": "channel",
                        "channelId": "019a0000-0000-7000-8000-000000000001",
                        "messageId": "019a0000-0000-7000-8000-000000000002",
                        "threadId": null
                    }
                },
                "attributes": {"push_type": "Alert", "collapse_key": "message"},
                "ios_device_endpoints": {
                    "macro|alice@example.com": {"endpoints": ["alice-phone"]},
                    "macro|bob@example.com": {"endpoints": ["bob-phone"]}
                }
            }
        }
    }))
    .unwrap();
    let outcomes = service.deliver_notification(message).await;
    assert_eq!(outcomes.len(), 2);
    assert!(outcomes.iter().all(Result::is_ok));
    let payloads = service.mobile.payloads.lock().unwrap();
    assert_eq!(
        payloads["alice-phone"]["recipientId"],
        "macro|alice@example.com"
    );
    assert_eq!(
        payloads["bob-phone"]["recipientId"],
        "macro|bob@example.com"
    );
    for payload in payloads.values() {
        assert_eq!(
            payload["navigation"]["messageId"],
            "019a0000-0000-7000-8000-000000000002"
        );
        assert_eq!(
            payload["notificationId"],
            "019a0000-0000-7000-8000-000000000004"
        );
    }
}
