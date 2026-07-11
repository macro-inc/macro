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
