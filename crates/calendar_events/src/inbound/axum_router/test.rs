use super::*;
use chrono::TimeZone;

#[test]
fn midnight_end_uses_the_same_exclusive_date() {
    let end = Utc.with_ymd_and_hms(2026, 7, 25, 0, 0, 0).unwrap();

    assert_eq!(default_end_date(end), NaiveDate::from_ymd_opt(2026, 7, 25));
}

#[test]
fn timed_end_includes_the_end_day_for_all_day_overlap() {
    let end = Utc.with_ymd_and_hms(2026, 7, 25, 18, 30, 0).unwrap();

    assert_eq!(default_end_date(end), NaiveDate::from_ymd_opt(2026, 7, 26));
}

#[test]
fn occurrence_limit_rejects_zero_and_values_above_the_public_maximum() {
    assert!(query_limits(Some(0)).is_err());
    assert!(query_limits(Some(2001)).is_err());
}

#[test]
fn occurrence_limit_reserves_one_repository_row_for_truncation_detection() {
    assert_eq!(query_limits(Some(2000)).unwrap(), (2000, 2001));
    assert_eq!(query_limits(None).unwrap(), (1000, 1001));
}

#[test]
fn occurrence_cursor_round_trips_equal_start_tie_breakers() {
    let cursor = CalendarOccurrenceCursor {
        starts_at: Utc.with_ymd_and_hms(2026, 7, 25, 12, 0, 0).unwrap(),
        event_id: uuid::Uuid::now_v7(),
        occurrence_key: "same-start-instance".to_string(),
    };
    let encoded = Base64Str::encode_json(cursor.clone()).type_erase();

    assert_eq!(decode_cursor(Some(encoded)).unwrap(), Some(cursor));
    assert!(decode_cursor(Some("not-base64".to_string())).is_err());
}

#[test]
fn mention_preview_items_serialize_the_preview_contract() {
    let event_id = uuid::Uuid::now_v7();
    let starts_at = Utc.with_ymd_and_hms(2026, 8, 19, 19, 0, 0).unwrap();
    let accessible = CalendarMentionPreviewItem {
        event_id,
        kind: CalendarMentionPreviewKind::Access,
        event: Some(CalendarMentionEvent {
            viewer_event_id: event_id,
            title: "Smart Macro Discussion".to_string(),
            time: crate::domain::models::EventTime::Timed {
                starts_at,
                ends_at: starts_at + chrono::Duration::minutes(90),
                time_zone: Some("America/New_York".to_string()),
            },
            occurrence_key: Some(starts_at.to_rfc3339()),
            is_recurring: false,
            location: None,
            organizer_email: Some("teo@example.com".to_string()),
            organizer_name: None,
            attendee_count: 3,
            updated_at: starts_at,
        }),
    };
    let json = serde_json::to_value(&accessible).unwrap();
    assert_eq!(json["type"], "access");
    assert_eq!(json["eventId"], event_id.to_string());
    assert_eq!(json["event"]["viewerEventId"], event_id.to_string());
    assert_eq!(json["event"]["time"]["kind"], "timed");
    assert_eq!(json["event"]["attendeeCount"], 3);

    let no_access = CalendarMentionPreviewItem {
        event_id,
        kind: CalendarMentionPreviewKind::NoAccess,
        event: None,
    };
    let json = serde_json::to_value(&no_access).unwrap();
    assert_eq!(json["type"], "no_access");
    assert!(json.get("event").is_none());

    let deleted = CalendarMentionPreviewItem {
        event_id,
        kind: CalendarMentionPreviewKind::DoesNotExist,
        event: None,
    };
    assert_eq!(
        serde_json::to_value(&deleted).unwrap()["type"],
        "does_not_exist"
    );
}
