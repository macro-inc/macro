use super::*;

#[test]
fn cursor_round_trips_the_keyset_position() {
    let at = DateTime::parse_from_rfc3339("2026-08-01T12:34:56Z")
        .unwrap()
        .with_timezone(&Utc);
    let id = Uuid::from_u128(9);

    let encoded = encode_cursor(at, id, 25);
    let decoded = decode_cursor(encoded).expect("cursor decodes");

    assert_eq!(decoded, (at, id));
}

#[test]
fn garbage_cursors_are_rejected() {
    assert!(decode_cursor("not base64 json".to_string()).is_err());
}

#[test]
fn feed_limits_are_defaulted_and_clamped() {
    assert_eq!(parse_feed_limit(None).unwrap().get(), 25);
    assert_eq!(parse_feed_limit(Some(100)).unwrap().get(), 100);
    assert!(parse_feed_limit(Some(0)).is_err());
    assert!(parse_feed_limit(Some(-3)).is_err());
    assert!(parse_feed_limit(Some(101)).is_err());
}
