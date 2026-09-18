use super::*;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use workspace_privacy::domain::PrivacyError;

#[derive(Clone, Default)]
struct TestPolicy {
    restricted: Arc<AtomicBool>,
    unavailable: Arc<AtomicBool>,
}
impl TestPolicy {
    fn decision(&self) -> Result<bool, PrivacyError> {
        if self.unavailable.load(Ordering::SeqCst) {
            return Err(PrivacyError::Unavailable);
        }
        Ok(self.restricted.load(Ordering::SeqCst))
    }
}
#[async_trait::async_trait]
impl DisclosurePolicy for TestPolicy {
    async fn restricted_team(&self, _: Uuid) -> Result<bool, PrivacyError> {
        self.decision()
    }
    async fn restricted_user(&self, _: &str) -> Result<bool, PrivacyError> {
        self.decision()
    }
    async fn restricted_push(&self, _: &str, _: Option<Uuid>) -> Result<bool, PrivacyError> {
        self.decision()
    }
    async fn any_restricted_workspace(&self) -> Result<bool, PrivacyError> {
        self.decision()
    }
}

#[derive(Clone, Default)]
struct RecordingSender(Arc<Mutex<Vec<Value>>>);
impl NotificationSender for RecordingSender {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        _: &str,
        notification: &APNSPushNotification<T>,
        attributes: &MessageAttributes,
    ) -> Result<String, Report> {
        self.0
            .lock()
            .unwrap()
            .push(json!({"payload":notification, "attributes":attributes}));
        Ok("delivered".into())
    }
    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        _: &str,
        _: &FCMMessage<T>,
        _: &MessageAttributes,
    ) -> Result<String, Report> {
        panic!("restricted Android must not send")
    }
}

#[tokio::test]
async fn a_queued_payload_is_redacted_after_enablement_and_on_policy_failure() {
    let policy = TestPolicy::default();
    let inner = RecordingSender::default();
    let sender = PrivatePushSender {
        inner: inner.clone(),
        policy: policy.clone(),
    };
    let notification = APNSPushNotification {
        aps: Aps {
            alert: Some(Alert::Simple("patient diagnosis".into())),
            mutable_content: Some(1),
            thread_id: Some("patient name".into()),
            ..Aps::default()
        },
        push_notification_data: json!({"notificationId": Uuid::nil(), "senderProfilePictureUrl":"https://example.com/patient", "futureSecretField":"diagnosis"}),
    };
    let attrs = MessageAttributes {
        push_type: PushType::Alert,
        collapse_key: "sensitive-key".into(),
    };
    sender
        .send_ios_push_notification("endpoint", &notification, &attrs)
        .await
        .unwrap();
    assert!(inner.0.lock().unwrap()[0].to_string().contains("diagnosis"));
    policy.restricted.store(true, Ordering::SeqCst);
    sender
        .send_ios_push_notification("endpoint", &notification, &attrs)
        .await
        .unwrap();
    policy.restricted.store(false, Ordering::SeqCst);
    policy.unavailable.store(true, Ordering::SeqCst);
    sender
        .send_ios_push_notification("endpoint", &notification, &attrs)
        .await
        .unwrap();
    for record in inner.0.lock().unwrap().iter().skip(1) {
        assert_eq!(
            record["payload"],
            serde_json::to_value(private_notification(Some(Uuid::nil()))).unwrap()
        );
        assert_eq!(
            record["attributes"]["collapse_key"],
            "macro-private-activity"
        );
    }
}

#[tokio::test]
async fn clearing_notifications_does_not_generate_a_new_alert() {
    let policy = TestPolicy::default();
    policy.restricted.store(true, Ordering::SeqCst);
    let inner = RecordingSender::default();
    let sender = PrivatePushSender {
        inner: inner.clone(),
        policy,
    };
    let notification = APNSPushNotification {
        aps: Aps::default(),
        push_notification_data: json!({"identifier":"sensitive"}),
    };
    sender
        .send_ios_push_notification(
            "endpoint",
            &notification,
            &MessageAttributes {
                push_type: PushType::Background,
                collapse_key: "sensitive".into(),
            },
        )
        .await
        .unwrap();
    let records = inner.0.lock().unwrap();
    assert_eq!(
        records[0]["payload"]["aps"],
        json!({"content-available": 1})
    );
    assert_eq!(
        records[0]["payload"]["identifier"],
        "macro-private-activity"
    );
}

#[test]
fn private_payload_is_an_allowlist_and_cannot_rehydrate_content() {
    let id = Uuid::nil();
    let payload = serde_json::to_value(private_notification(Some(id))).unwrap();
    assert_eq!(
        payload,
        json!({
            "aps": { "alert": "New activity in Macro. Open the app to view it.", "sound": "default" },
            "notificationId": id
        })
    );
    assert_eq!(
        notification_id(
            &json!({"notificationId": id, "senderProfilePictureUrl": "https://example.com/patient"})
        ),
        Some(id)
    );
    assert_eq!(
        notification_id(&json!({"notificationId": "not-a-uuid"})),
        None
    );
    assert_eq!(private_notification(None).push_notification_data, json!({}));
}

#[derive(Clone, Default)]
struct RecordingEmail(Arc<Mutex<Vec<(String, String)>>>);
impl EmailSender for RecordingEmail {
    async fn send_email(
        &self,
        _: MacroUserIdStr<'_>,
        content: &EmailContent,
    ) -> Result<(), Report> {
        self.0
            .lock()
            .unwrap()
            .push((content.subject.clone(), content.body.clone()));
        Ok(())
    }
}

#[tokio::test]
async fn email_digests_are_generic_after_policy_changes_and_on_lookup_failure() {
    let policy = TestPolicy::default();
    let inner = RecordingEmail::default();
    let sender = PrivateEmailSender {
        inner: inner.clone(),
        policy: policy.clone(),
    };
    let content = EmailContent {
        subject: "Patient name".into(),
        body: "<p>Diagnosis</p>".into(),
    };
    let recipient = MacroUserIdStr::parse_from_str("macro|recipient@example.com").unwrap();
    sender
        .send_email(recipient.clone(), &content)
        .await
        .unwrap();
    assert_eq!(inner.0.lock().unwrap()[0].0, "Patient name");
    policy.restricted.store(true, Ordering::SeqCst);
    sender
        .send_email(recipient.clone(), &content)
        .await
        .unwrap();
    policy.restricted.store(false, Ordering::SeqCst);
    policy.unavailable.store(true, Ordering::SeqCst);
    sender.send_email(recipient, &content).await.unwrap();
    for (subject, body) in inner.0.lock().unwrap().iter().skip(1) {
        assert_eq!(subject, "New activity in Macro");
        assert_eq!(
            body,
            "<p>You have new activity in Macro. Open the app and sign in to view it.</p>"
        );
    }
}

impl VoipPushDelivery for RecordingSender {
    async fn send_voip_push(&self, _: &str, _: &VoipPushPayload) -> Result<String, Report> {
        panic!("restricted VoIP must not reach the delivery provider")
    }
}

#[tokio::test]
async fn voip_credentials_are_withheld_on_policy_failure() {
    let policy = TestPolicy::default();
    policy.unavailable.store(true, Ordering::SeqCst);
    let sender = PrivatePushSender {
        inner: RecordingSender::default(),
        policy,
    };
    let payload = VoipPushPayload {
        aps: Default::default(),
        call_id: "opaque-call".into(),
        channel_id: "opaque-channel".into(),
        channel_name: "Patient name".into(),
        caller_name: "Clinician name".into(),
        livekit_server_url: None,
        livekit_token: Some("bearer-secret".into()),
        ring_status_url: None,
    };
    let error = sender
        .send_voip_push("endpoint", &payload)
        .await
        .unwrap_err();
    assert!(!error.to_string().contains("bearer-secret"));
}
