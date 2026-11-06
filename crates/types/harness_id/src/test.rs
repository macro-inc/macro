use super::*;

#[test]
fn round_trips_through_display_and_from_str() {
    let id = HarnessId::TEST_A;
    let text = id.to_string();
    let parsed: HarnessId = text.parse().expect("display output parses");
    assert_eq!(parsed, id);
}

#[test]
fn rejects_non_uuid_input() {
    let error = HarnessId::parse_uuid_str("not-a-uuid").unwrap_err();
    assert_eq!(error.to_string(), "invalid harness id: not-a-uuid");
}

#[test]
fn serde_is_transparent() {
    let id = HarnessId::TEST_B;
    let json = serde_json::to_string(&id).expect("serializes");
    assert_eq!(json, format!("\"{}\"", id.as_uuid()));
    let back: HarnessId = serde_json::from_str(&json).expect("deserializes");
    assert_eq!(back, id);
}
