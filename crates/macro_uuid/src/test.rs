use super::*;

#[test]
fn test_bidirectional_conversion() {
    let converter = ShortUuidConverter::default();

    // Start with a known UUID
    let original_uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();

    // Convert to short UUID
    let short = converter.from_uuid(&original_uuid);

    // Convert back to UUID
    let recovered_uuid = converter.to_uuid(&short).unwrap();

    // They should match
    assert_eq!(original_uuid, recovered_uuid);
}

#[test]
fn test_short_id_is_shorter_than_uuid() {
    let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
    let uuid = string_to_uuid(uuid_str).unwrap();
    let short_id = ShortUuidConverter::default().from_uuid(&uuid);
    assert!(!short_id.is_empty());
    assert!(short_id.len() < uuid_str.len());
}

#[test]
fn test_string_to_uuid_invalid_input() {
    let result = string_to_uuid("not-a-uuid");
    assert!(result.is_err());
}

#[test]
fn test_specific_conversion() {
    let converter = ShortUuidConverter::default();
    // TODO: add more tests
    let uuids = vec![(
        "0d0dc589-f301-43f1-8b11-4ab448ca4bb4",
        "2BuyvtY3aeEvHx4uG8iD51",
    )];

    for (uuid, short) in uuids {
        let converted_uuid = Uuid::parse_str(uuid).unwrap();
        let converted_short = converter.from_uuid(&converted_uuid);
        assert_eq!((uuid, converted_short.as_str()), (uuid, short));
    }
}
