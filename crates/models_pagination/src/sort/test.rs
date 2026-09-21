use super::*;
use crate::CursorVal;

#[test]
fn notified_at_marker_round_trips_as_a_string() {
    let json = serde_json::to_string(&NotifiedAt).unwrap();
    assert_eq!(json, r#""notified_at""#);
    let parsed: NotifiedAt = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, NotifiedAt);
}

#[test]
fn notified_at_marker_rejects_other_tags() {
    assert!(serde_json::from_str::<NotifiedAt>(r#""touched_by_me""#).is_err());
    assert!(serde_json::from_str::<NotifiedAt>("null").is_err());
}

/// Touched and notified cursors carry the same value type, so the marker is
/// what keeps a cursor extractor from decoding one as the other.
#[test]
fn touched_and_notified_cursor_values_do_not_cross_decode() {
    let ts = DateTime::<Utc>::UNIX_EPOCH;
    let touched = serde_json::to_string(&CursorVal {
        sort_type: TouchedByMe,
        last_val: ts,
    })
    .unwrap();
    let notified = serde_json::to_string(&CursorVal {
        sort_type: NotifiedAt,
        last_val: ts,
    })
    .unwrap();

    assert!(serde_json::from_str::<CursorVal<TouchedByMe>>(&touched).is_ok());
    assert!(serde_json::from_str::<CursorVal<NotifiedAt>>(&touched).is_err());
    assert!(serde_json::from_str::<CursorVal<NotifiedAt>>(&notified).is_ok());
    assert!(serde_json::from_str::<CursorVal<TouchedByMe>>(&notified).is_err());
}
