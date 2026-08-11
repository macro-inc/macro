use activity::{Action, RecordedAction};
use macro_user_id::user_id::MacroUserIdStr;

use super::*;

#[test]
fn cursor_round_trips_the_keyset_position() {
    let record = ActivityRecord {
        id: Uuid::from_u128(9),
        actor: activity::Actor::new_from_user(
            MacroUserIdStr::try_from("macro|teo@example.com".to_string()).expect("valid user id"),
        ),
        subject_id: "macro|teo@example.com".to_string(),
        entity_type: activity::EntityType::Document,
        entity_id: "doc-1".to_string(),
        action: RecordedAction::Known(Action::Edited),
        occurred_at: DateTime::parse_from_rfc3339("2026-08-01T12:34:56Z")
            .unwrap()
            .with_timezone(&Utc),
    };

    let encoded = encode_cursor(&record, 25);
    let (occurred_at, id) = decode_cursor(encoded).expect("cursor decodes");

    assert_eq!(occurred_at, record.occurred_at);
    assert_eq!(id, record.id);
}

#[test]
fn garbage_cursors_are_rejected() {
    assert!(decode_cursor("not base64 json".to_string()).is_err());
}

#[test]
fn feed_limits_are_defaulted_and_clamped() {
    assert_eq!(parse_feed_limit(None).unwrap(), 25);
    assert_eq!(parse_feed_limit(Some(100)).unwrap(), 100);
    assert!(parse_feed_limit(Some(0)).is_err());
    assert!(parse_feed_limit(Some(-3)).is_err());
    assert!(parse_feed_limit(Some(101)).is_err());
}
