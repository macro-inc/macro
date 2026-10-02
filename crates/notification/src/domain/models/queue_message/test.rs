use super::*;

#[test]
fn test_apns_targets_deserializes_with_per_user_endpoints() {
    let json = r#"{
        "notif": {
            "aps": {
                "alert": {
                    "title": "Test Title",
                    "body": "Test Body"
                },
                "sound": "default"
            },
            "notificationId": "550e8400-e29b-41d4-a716-446655440000"
        },
        "attributes": {
            "push_type": "Alert",
            "collapse_key": "test-collapse-key"
        },
        "ios_device_endpoints": {
            "macro|alice@example.com": {
                "endpoints": ["endpoint1", "endpoint2"]
            },
            "macro|bob@example.com": {
                "endpoints": ["endpoint3"]
            }
        }
    }"#;

    let result: Result<APNSTargets<serde_json::Value>, _> = serde_json::from_str(json);

    assert!(
        result.is_ok(),
        "Per-user endpoint format should deserialize successfully: {:?}",
        result.err()
    );

    let targets = result.unwrap();
    assert_eq!(targets.ios_device_endpoints.len(), 2);
    let total_endpoints: usize = targets
        .ios_device_endpoints
        .values()
        .map(|u| u.endpoints.len())
        .sum();
    assert_eq!(total_endpoints, 3);
    assert_eq!(targets.attributes.collapse_key, "test-collapse-key");

    // Verify digest_state defaults to None when not present
    for user_endpoints in targets.ios_device_endpoints.values() {
        assert!(user_endpoints.digest_state.is_none());
        assert!(user_endpoints.android_endpoints.is_empty());
    }
}

#[test]
fn test_ingress_queue_message_round_trip() {
    use crate::domain::models::SendNotificationRequestBuilder;
    use model_entity::EntityType;
    use std::collections::HashSet;

    #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
    struct MyNotif {
        msg: String,
    }
    impl crate::domain::models::Notification for MyNotif {
        const TYPE_NAME: &'static str = "my_notif";
    }

    let recipient =
        macro_user_id::user_id::MacroUserIdStr::try_from_email("user@example.com").unwrap();

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("doc_1"),
        secondary_notification_entity: None,
        notification: MyNotif {
            msg: "hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([recipient]),
    }
    .into_request()
    .with_conn_gateway();

    // Type-erase into IngressQueueMessage
    let ingress_msg = IngressQueueMessage::from_request(&request).unwrap();

    // Serialize to JSON and back
    let json = serde_json::to_string(&ingress_msg).unwrap();
    let deserialized: IngressQueueMessage = serde_json::from_str(&json).unwrap();

    // Verify key fields survived the round-trip
    assert_eq!(
        deserialized.request.req.notification.tag.as_ref(),
        "my_notif"
    );
    assert!(deserialized.request.send_conn_gateway);
    assert_eq!(deserialized.request.req.recipient_ids.len(), 1);
    assert_eq!(
        deserialized.request.req.notification.content["msg"],
        "hello"
    );
}

#[test]
fn mobile_publication_filter_preserves_both_platforms_for_active_recipient() {
    let active = MacroUserIdStr::try_from_email("active@example.com").unwrap();
    let dismissed = MacroUserIdStr::try_from_email("dismissed@example.com").unwrap();
    let message: QueueMessage<'static, serde_json::Value, serde_json::Value> =
        serde_json::from_value(serde_json::json!({
            "message_type": "test_notification",
            "content": {
                "Ios": {
                    "notif": {
                        "aps": {
                            "alert": {"title": "Test", "body": "Body"},
                            "sound": "default"
                        },
                        "notificationId": "550e8400-e29b-41d4-a716-446655440000"
                    },
                    "attributes": {
                        "push_type": "Alert",
                        "collapse_key": "test-collapse-key"
                    },
                    "ios_device_endpoints": {
                        (active.as_ref()): {
                            "endpoints": ["active-ios"],
                            "android_endpoints": ["active-android"]
                        },
                        (dismissed.as_ref()): {
                            "endpoints": ["dismissed-ios"],
                            "android_endpoints": ["dismissed-android"]
                        }
                    }
                }
            }
        }))
        .unwrap();

    let filtered = message
        .retain_active_recipients(&HashSet::from([active.clone()]))
        .unwrap();
    let value = serde_json::to_value(filtered).unwrap();
    let targets = &value["content"]["Ios"]["ios_device_endpoints"];
    assert_eq!(targets.as_object().unwrap().len(), 1);
    assert_eq!(
        targets[active.as_ref()]["endpoints"],
        serde_json::json!(["active-ios"])
    );
    assert_eq!(
        targets[active.as_ref()]["android_endpoints"],
        serde_json::json!(["active-android"])
    );
    assert!(targets.get(dismissed.as_ref()).is_none());
}

#[test]
fn email_publication_filter_drops_intent_for_inactive_recipient() {
    let recipient = MacroUserIdStr::try_from_email("dismissed-email@example.com").unwrap();
    let message: QueueMessage<'static, serde_json::Value, serde_json::Value> =
        QueueMessage::new_test(
            "test_notification".to_string(),
            NotificationChannel::Email(EmailNotification {
                to: recipient,
                content: EmailContent {
                    subject: "subject".to_string(),
                    body: "body".to_string(),
                },
                rate_limit_config: RateLimitConfig {
                    max_count: 1,
                    window: std::time::Duration::from_secs(60),
                },
                rate_limit_key: RateLimitKey::from_str_hashed(&"email-filter"),
            }),
        );

    assert!(message.retain_active_recipients(&HashSet::new()).is_none());
}
