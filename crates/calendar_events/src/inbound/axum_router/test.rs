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
