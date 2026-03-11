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
