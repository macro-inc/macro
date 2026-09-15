use super::*;

#[test]
fn bus_events_are_tagged_so_the_untagged_consumer_can_tell_them_apart() {
    let request = ChangesBusEvent::CollectChanges {
        request_id: Uuid::from_u128(1),
        harness: HarnessId::TEST_A,
    };
    let json = serde_json::to_value(&request).unwrap();
    assert_eq!(json["type"], "collectChanges");
    assert!(json.get("requestId").is_some());

    let answer = ChangesBusEvent::ChangesCollected {
        request_id: Uuid::from_u128(1),
        result: CollectChangesResult::Error {
            message: "no".to_owned(),
        },
    };
    let json = serde_json::to_value(&answer).unwrap();
    assert_eq!(json["type"], "changesCollected");
    let back: ChangesBusEvent = serde_json::from_value(json).unwrap();
    assert!(matches!(back, ChangesBusEvent::ChangesCollected { .. }));
}
