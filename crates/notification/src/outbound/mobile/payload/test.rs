use super::*;
use crate::domain::models::apple::{AlertDictionary, Aps, PushNotificationData};
use serde_json::{Value, json};
use uuid::Uuid;

#[test]
fn android_alert_uses_sns_fcm_v1_with_string_data() {
    let id = Uuid::now_v7();
    let notification = FCMMessage::notification(
        "Alice mentioned you".into(),
        "A message with \"quotes\" and 🦀".into(),
        "stable-identifier".into(),
        PushNotificationData {
            notification_id: id,
            sender_profile_picture_url: Some("https://example.com/avatar.png".into()),
        },
        macro_user_id::user_id::MacroUserIdStr::try_from_email("alice@example.com").unwrap(),
    );
    let sns: Value =
        serde_json::from_str(&SnsTarget::Android(&notification).as_json().unwrap()).unwrap();
    assert_eq!(sns["default"], "Alice mentioned you");
    let fcm: Value = serde_json::from_str(sns["GCM"].as_str().unwrap()).unwrap();
    let message = &fcm["fcmV1Message"]["message"];
    assert_eq!(message["android"]["priority"], "high");
    assert!(message.get("notification").is_none());
    assert!(message["android"].get("notification").is_none());
    let data = &message["data"];
    assert!(data.as_object().unwrap().values().all(Value::is_string));
    assert_eq!(data["type"], "notification");
    assert_eq!(data["identifier"], "stable-identifier");
    assert_eq!(data["recipientId"], "macro|alice@example.com");
    assert_eq!(data["body"], "A message with \"quotes\" and 🦀");
    let metadata: Value = serde_json::from_str(data["payload"].as_str().unwrap()).unwrap();
    assert_eq!(metadata["notificationId"], id.to_string());
}

#[test]
fn android_clear_is_silent_and_preserves_the_display_identifier() {
    let notification = FCMMessage::clear(
        "stable-identifier".into(),
        json!({}),
        macro_user_id::user_id::MacroUserIdStr::try_from_email("alice@example.com").unwrap(),
    );
    let sns: Value =
        serde_json::from_str(&SnsTarget::Android(&notification).as_json().unwrap()).unwrap();
    let fcm: Value = serde_json::from_str(sns["GCM"].as_str().unwrap()).unwrap();
    let message = &fcm["fcmV1Message"]["message"];
    assert_eq!(message["android"]["priority"], "normal");
    assert_eq!(message["data"]["type"], "clear");
    assert_eq!(message["data"]["identifier"], "stable-identifier");
    assert!(message["data"].get("title").is_none());
    assert!(message["data"].get("body").is_none());
    assert!(message.get("notification").is_none());
}

#[test]
fn ios_payload_keeps_production_and_sandbox_envelopes() {
    let notification = APNSPushNotification {
        aps: Aps {
            alert: Some(Alert::Dictionary(AlertDictionary {
                title: Some("Title".into()),
                body: Some("Body".into()),
                ..Default::default()
            })),
            ..Default::default()
        },
        push_notification_data: json!({"notificationId": "existing-id"}),
    };
    let sns: Value =
        serde_json::from_str(&SnsTarget::Ios(&notification).as_json().unwrap()).unwrap();
    assert_eq!(sns["default"], "Title");
    assert_eq!(sns["APNS"], sns["APNS_SANDBOX"]);
    assert_eq!(
        serde_json::from_str::<Value>(sns["APNS"].as_str().unwrap()).unwrap(),
        serde_json::to_value(&notification).unwrap()
    );
}

#[test]
fn payload_serialization_errors_are_returned_without_panicking() {
    struct InvalidMetadata;
    impl Serialize for InvalidMetadata {
        fn serialize<S: Serializer>(&self, _: S) -> Result<S::Ok, S::Error> {
            Err(serde::ser::Error::custom("invalid metadata"))
        }
    }
    let notification = FCMMessage::clear(
        "id".into(),
        InvalidMetadata,
        macro_user_id::user_id::MacroUserIdStr::try_from_email("alice@example.com").unwrap(),
    );
    assert!(SnsTarget::Android(&notification).as_json().is_err());
}

#[test]
fn android_call_push_is_short_lived_data_only_and_recipient_scoped() {
    let payload = VoipPushPayload {
        aps: Default::default(),
        call_id: Uuid::new_v4().to_string(),
        channel_id: "channel-1".into(),
        channel_name: "General".into(),
        caller_name: "Alice".into(),
        livekit_server_url: Some("wss://livekit.example".into()),
        livekit_token: Some("recipient-token".into()),
        ring_status_url: Some("https://dev.macro.com/call/ring-status/call-1".into()),
    };
    let target: SnsTarget<'_, ()> = SnsTarget::AndroidCall(&payload, "macro|bob@example.com");
    let sns: Value = serde_json::from_str(&target.as_json().unwrap()).unwrap();
    assert!(sns.get("APNS_VOIP").is_none());
    let fcm: Value = serde_json::from_str(sns["GCM"].as_str().unwrap()).unwrap();
    let message = &fcm["fcmV1Message"]["message"];
    assert_eq!(message["android"]["priority"], "high");
    assert_eq!(message["android"]["ttl"], "60s");
    assert!(message.get("notification").is_none());
    assert_eq!(message["data"]["type"], "call");
    assert_eq!(message["data"]["recipientId"], "macro|bob@example.com");
    assert!(
        message["data"]
            .as_object()
            .unwrap()
            .values()
            .all(Value::is_string)
    );
    let offer: Value = serde_json::from_str(message["data"]["payload"].as_str().unwrap()).unwrap();
    assert_eq!(offer["livekitToken"], "recipient-token");
    assert_eq!(offer["callId"], payload.call_id);
}
