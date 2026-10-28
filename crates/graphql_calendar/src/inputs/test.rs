use calendar_events::domain::models::CalendarOccurrenceCursor;
use chrono::{NaiveDate, TimeZone, Utc};
use uuid::Uuid;

use super::*;

fn input(start: &str, end: &str) -> CalendarRangeInput {
    CalendarRangeInput {
        start: start.to_owned(),
        end: end.to_owned(),
        start_date: None,
        end_date: None,
        first: None,
        after: None,
    }
}

fn error_code(error: async_graphql::Error) -> String {
    let extensions = error.extensions.expect("extensions");
    extensions.get("code").expect("code").to_string()
}

#[test]
fn defaults_dates_and_page_size_from_the_instants() {
    let request = input("2026-10-05T04:00:00Z", "2026-10-12T04:00:00Z")
        .into_page_request()
        .unwrap();

    assert_eq!(request.page_size, 1000);
    assert_eq!(request.cursor, None);
    assert_eq!(
        request.range.starts_at,
        Utc.with_ymd_and_hms(2026, 10, 5, 4, 0, 0).unwrap()
    );
    assert_eq!(
        request.range.start_date,
        NaiveDate::from_ymd_opt(2026, 10, 5).unwrap()
    );
    assert_eq!(
        request.range.end_date,
        NaiveDate::from_ymd_opt(2026, 10, 13).unwrap()
    );
}

#[test]
fn a_midnight_end_keeps_its_own_date_as_the_exclusive_bound() {
    let request = input("2026-10-05T00:00:00Z", "2026-10-12T00:00:00Z")
        .into_page_request()
        .unwrap();

    assert_eq!(
        request.range.end_date,
        NaiveDate::from_ymd_opt(2026, 10, 12).unwrap()
    );
}

#[test]
fn explicit_local_dates_win_and_offsets_normalize_to_utc() {
    let mut range = input("2026-10-05T00:00:00-04:00", "2026-10-12T00:00:00-04:00");
    range.start_date = Some("2026-10-05".to_owned());
    range.end_date = Some("2026-10-12".to_owned());

    let request = range.into_page_request().unwrap();

    assert_eq!(
        request.range.starts_at,
        Utc.with_ymd_and_hms(2026, 10, 5, 4, 0, 0).unwrap()
    );
    assert_eq!(
        request.range.end_date,
        NaiveDate::from_ymd_opt(2026, 10, 12).unwrap()
    );
}

#[test]
fn page_size_is_bounded() {
    for first in [0, -1, 2001] {
        let mut range = input("2026-10-05T00:00:00Z", "2026-10-12T00:00:00Z");
        range.first = Some(first);
        let error = range.into_page_request().unwrap_err();
        assert_eq!(error_code(error), "\"BAD_USER_INPUT\"");
    }
    let mut range = input("2026-10-05T00:00:00Z", "2026-10-12T00:00:00Z");
    range.first = Some(2000);
    assert_eq!(range.into_page_request().unwrap().page_size, 2000);
}

#[test]
fn malformed_values_are_user_errors() {
    for (start, end, end_date, after) in [
        ("yesterday", "2026-10-12T00:00:00Z", None, None),
        ("2026-10-05T00:00:00Z", "2026-10-12", None, None),
        (
            "2026-10-05T00:00:00Z",
            "2026-10-12T00:00:00Z",
            Some("10/12/2026"),
            None,
        ),
        (
            "2026-10-05T00:00:00Z",
            "2026-10-12T00:00:00Z",
            None,
            Some("not-a-cursor"),
        ),
    ] {
        let mut range = input(start, end);
        range.end_date = end_date.map(str::to_owned);
        range.after = after.map(str::to_owned);
        let error = range.into_page_request().unwrap_err();
        assert_eq!(error_code(error), "\"BAD_USER_INPUT\"");
    }
}

#[test]
fn cursor_round_trips() {
    let cursor = CalendarOccurrenceCursor {
        starts_at: Utc.with_ymd_and_hms(2026, 10, 6, 15, 0, 0).unwrap(),
        event_id: Uuid::from_u128(9),
        occurrence_key: "2026-10-06T15:00:00+00:00".to_owned(),
    };
    let mut range = input("2026-10-05T00:00:00Z", "2026-10-12T00:00:00Z");
    range.after = Some(encode_cursor(cursor.clone()));

    assert_eq!(range.into_page_request().unwrap().cursor, Some(cursor));
}
