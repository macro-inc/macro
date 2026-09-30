use super::*;
use crate::domain::models::apple::{AlertDictionary, Aps};
use serde_json::json;

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
