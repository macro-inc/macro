use super::*;

#[test]
fn test_apns_targets_deserializes_old_format_without_bulk_digest_state_machine() {
    // Old format did not have the bulk_digest_state_machine field
    let old_json = r#"{
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
        "ios_device_endpoints": ["endpoint1", "endpoint2"]
    }"#;

    let result: Result<APNSTargets<serde_json::Value>, _> = serde_json::from_str(old_json);

    assert!(
        result.is_ok(),
        "Old JSON format without bulk_digest_state_machine should deserialize successfully: {:?}",
        result.err()
    );

    let targets = result.unwrap();
    assert!(targets.bulk_digest_state_machine.is_none());
    assert_eq!(targets.ios_device_endpoints.len(), 2);
    assert_eq!(targets.attributes.collapse_key, "test-collapse-key");
}
