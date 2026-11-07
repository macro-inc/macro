use chrono::NaiveDate;
use serde_json::json;

use super::*;

fn span(start: Value, end: Value) -> Span {
    let fields = json!({ "start": start, "end": end });
    Span::of(fields.as_object().unwrap()).unwrap()
}

fn day(day: u32) -> Point {
    Point::AllDay(NaiveDate::from_ymd_opt(2026, 11, day).unwrap())
}

#[test]
fn an_all_day_series_ends_on_its_until_date_and_skips_its_excluded_days() {
    let starts = occurrence_starts(
        span(
            json!({ "date": "2026-11-02" }),
            json!({ "date": "2026-11-03" }),
        ),
        &[
            "RRULE:FREQ=DAILY;UNTIL=20261106".to_string(),
            "EXDATE;VALUE=DATE:20261104".to_string(),
        ],
        Window::default(),
    )
    .unwrap();

    assert_eq!(starts, vec![day(2), day(3), day(5), day(6)]);
}

#[test]
fn a_series_keeps_its_local_hour_across_a_daylight_saving_change() {
    let starts = occurrence_starts(
        span(
            json!({ "dateTime": "2026-10-26T09:00:00-04:00", "timeZone": "America/New_York" }),
            json!({ "dateTime": "2026-10-26T09:30:00-04:00", "timeZone": "America/New_York" }),
        ),
        &["RRULE:FREQ=WEEKLY;COUNT=3".to_string()],
        Window::default(),
    )
    .unwrap();

    let suffixes: Vec<String> = starts.into_iter().map(Point::instance_suffix).collect();
    assert_eq!(
        suffixes,
        vec!["20261026T130000Z", "20261102T140000Z", "20261109T140000Z"]
    );
}

#[test]
fn a_window_keeps_the_occurrences_that_can_overlap_it() {
    let hour = span(
        json!({ "dateTime": "2026-11-02T10:00:00Z" }),
        json!({ "dateTime": "2026-11-02T11:00:00Z" }),
    );
    let window = Window {
        from: Some("2026-11-04T10:30:00Z".parse().unwrap()),
        until: Some("2026-11-05T10:00:00Z".parse().unwrap()),
    };

    let overlapping: Vec<String> =
        occurrence_starts(hour, &["RRULE:FREQ=DAILY".to_string()], window)
            .unwrap()
            .into_iter()
            .filter(|start| hour.starting_at(*start).overlaps(window, Tz::UTC))
            .map(Point::instance_suffix)
            .collect();

    // The occurrence under way at the lower bound counts; the one starting
    // at the upper bound does not.
    assert_eq!(overlapping, vec!["20261104T100000Z"]);
}

#[test]
fn times_google_refuses_are_refused() {
    let reason = |start: Value, end: Value| {
        let fields = json!({ "start": start, "end": end });
        Span::of(fields.as_object().unwrap()).unwrap_err().reason
    };

    assert_eq!(
        reason(
            json!({ "dateTime": "2026-11-02T11:00:00Z" }),
            json!({ "dateTime": "2026-11-02T10:00:00Z" })
        ),
        "timeRangeEmpty"
    );
    assert_eq!(
        reason(
            json!({ "date": "2026-11-02" }),
            json!({ "dateTime": "2026-11-02T10:00:00Z" })
        ),
        "invalid"
    );
    assert_eq!(
        reason(
            json!({ "dateTime": "noon" }),
            json!({ "date": "2026-11-02" })
        ),
        "invalid"
    );
}
