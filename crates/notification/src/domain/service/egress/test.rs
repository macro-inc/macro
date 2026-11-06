use super::*;
use crate::domain::models::apple::{AlertDictionary, Aps};
use serde_json::json;

#[test]
fn ios_delivery_binds_the_destination_to_each_receiving_account() {
    let template = APNSPushNotification {
        aps: Aps::default(),
        push_notification_data: json!({
            "notificationId": "019a0000-0000-7000-8000-000000000004",
            "recipientId": "macro|stale@example.com",
            "navigation": {
                "type": "channel",
                "channelId": "019a0000-0000-7000-8000-000000000001",
                "messageId": "019a0000-0000-7000-8000-000000000002",
                "threadId": null
            }
        }),
    };
    for email in ["alice@example.com", "bob@example.com"] {
        let recipient = MacroUserIdStr::try_from_email(email).unwrap();
        let payload = serde_json::to_value(ios_notification(&template, &recipient)).unwrap();
        assert_eq!(payload["recipientId"], recipient.as_ref());
        assert_eq!(
            payload["navigation"],
            template.push_notification_data["navigation"]
        );
        assert_eq!(
            payload["notificationId"],
            template.push_notification_data["notificationId"]
        );
    }
    assert_eq!(
        template.push_notification_data["recipientId"],
        "macro|stale@example.com"
    );
}

fn notification(alert: Option<Alert>, push_type: PushType) -> FCMMessage<serde_json::Value> {
    android_notification(
        &APNSTargets {
            notif: APNSPushNotification {
                aps: Aps {
                    alert,
                    ..Default::default()
                },
                push_notification_data: json!({"notificationId": "notification-id"}),
            },
            attributes: MessageAttributes {
                push_type,
                collapse_key: "identifier".into(),
            },
            ios_device_endpoints: Default::default(),
        },
        MacroUserIdStr::parse_from_str("macro|alice@example.com")
            .unwrap()
            .into_owned(),
    )
}

#[test]
fn empty_alerts_have_visible_fallback_text() {
    for alert in [
        None,
        Some(Alert::Simple(String::new())),
        Some(Alert::Simple(" \n".into())),
        Some(Alert::Dictionary(AlertDictionary::default())),
        Some(Alert::Dictionary(AlertDictionary {
            title: Some(" ".into()),
            subtitle: Some("\t".into()),
            body: Some("\n".into()),
            ..Default::default()
        })),
    ] {
        let message = notification(alert, PushType::Alert);
        assert_eq!(message.title.as_deref(), Some("New notification"));
        assert_eq!(message.identifier, "identifier");
        assert_eq!(message.data["notificationId"], "notification-id");
        assert_eq!(message.recipient_id.as_ref(), "macro|alice@example.com");
    }
}

#[test]
fn visible_alert_content_is_preserved() {
    let simple = notification(Some(Alert::Simple("Hello".into())), PushType::Alert);
    assert_eq!(simple.title.as_deref(), Some(""));
    assert_eq!(simple.body.as_deref(), Some("Hello"));
    let structured = notification(
        Some(Alert::Dictionary(AlertDictionary {
            title: Some("Alice".into()),
            subtitle: Some("Project".into()),
            body: Some("Hello".into()),
            ..Default::default()
        })),
        PushType::Alert,
    );
    assert_eq!(structured.title.as_deref(), Some("Alice — Project"));
    assert_eq!(structured.body.as_deref(), Some("Hello"));
}

#[test]
fn silent_clear_does_not_get_fallback_text() {
    let message = notification(None, PushType::Background);
    assert!(message.title.is_none());
    assert!(message.body.is_none());
    assert_eq!(message.identifier, "identifier");
}
