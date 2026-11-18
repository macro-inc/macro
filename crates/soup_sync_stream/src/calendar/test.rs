use super::*;
use serde_json::json;

fn at(iso: &str) -> DateTime<Utc> {
    iso.parse().unwrap()
}

fn ms(iso: &str) -> i64 {
    at(iso).timestamp_millis()
}

fn date(iso: &str) -> NaiveDate {
    iso.parse().unwrap()
}

fn starts(windows: &[CalendarWindow]) -> Vec<&str> {
    windows
        .iter()
        .map(|window| window.input["startDate"].as_str().unwrap())
        .collect()
}

#[test]
fn months_run_from_local_midnights_nearest_first() {
    let windows = calendar_windows(
        Tz::America__New_York,
        &[],
        at("2026-11-02T12:00:00Z"),
        1,
        10,
    );
    assert_eq!(starts(&windows), ["2026-11-01", "2026-12-01", "2026-10-01"]);
    let november = &windows[0];
    // November starts on daylight time and ends on standard time.
    assert_eq!(
        Value::Object(november.input.clone()),
        json!({
            "start": "2026-11-01T04:00:00.000Z",
            "end": "2026-12-01T05:00:00.000Z",
            "startDate": "2026-11-01",
            "endDate": "2026-12-01",
        })
    );
    assert_eq!(
        november.coverage,
        [
            CalendarSpan {
                kind: SpanKind::Timed,
                start: ms("2026-11-01T04:00:00Z"),
                end: ms("2026-12-01T05:00:00Z"),
            },
            CalendarSpan {
                kind: SpanKind::AllDay,
                start: epoch_day(date("2026-11-01")),
                end: epoch_day(date("2026-12-01")),
            },
        ]
    );
}

#[test]
fn months_stay_inside_the_materialized_range() {
    let windows = calendar_windows(Tz::UTC, &[], at("2026-11-02T12:00:00Z"), 12, 100);
    assert_eq!(windows.len(), 25);
    // 364 days back is 2025-11-03; the materialized range ends 729 days ahead.
    let earliest = windows.last().unwrap();
    assert_eq!(earliest.input["startDate"], "2025-11-03");
    assert_eq!(earliest.input["endDate"], "2025-12-01");
}

#[test]
fn only_what_the_cache_lacks_is_fetched() {
    // November is cached from the 10th on.
    let coverage = [
        CalendarSpan {
            kind: SpanKind::Timed,
            start: ms("2026-11-10T00:00:00Z"),
            end: ms("2026-12-01T00:00:00Z"),
        },
        CalendarSpan {
            kind: SpanKind::AllDay,
            start: epoch_day(date("2026-11-10")),
            end: epoch_day(date("2026-12-01")),
        },
    ];
    let windows = calendar_windows(Tz::UTC, &coverage, at("2026-11-02T12:00:00Z"), 0, 10);
    // The timed gap fetches its dates too, which covers the all-day gap.
    assert_eq!(windows.len(), 1);
    assert_eq!(
        Value::Object(windows[0].input.clone()),
        json!({
            "start": "2026-11-01T00:00:00.000Z",
            "end": "2026-11-10T00:00:00.000Z",
            "startDate": "2026-11-01",
            "endDate": "2026-11-10",
        })
    );

    // All-day days the timed gap does not span are fetched on their own.
    let coverage = [
        CalendarSpan {
            kind: SpanKind::Timed,
            start: ms("2026-11-01T00:00:00Z"),
            end: ms("2026-12-01T00:00:00Z"),
        },
        CalendarSpan {
            kind: SpanKind::AllDay,
            start: epoch_day(date("2026-11-01")),
            end: epoch_day(date("2026-11-20")),
        },
    ];
    let windows = calendar_windows(Tz::UTC, &coverage, at("2026-11-02T12:00:00Z"), 0, 10);
    assert_eq!(windows.len(), 1);
    assert_eq!(windows[0].input["startDate"], "2026-11-20");
    assert_eq!(windows[0].input["start"], "2026-11-20T00:00:00.000Z");
    assert_eq!(windows[0].coverage[1].start, epoch_day(date("2026-11-20")));

    let everything = [
        CalendarSpan {
            kind: SpanKind::Timed,
            start: 0,
            end: i64::MAX,
        },
        CalendarSpan {
            kind: SpanKind::AllDay,
            start: 0,
            end: i64::MAX,
        },
    ];
    assert!(calendar_windows(Tz::UTC, &everything, at("2026-11-02T12:00:00Z"), 12, 100).is_empty());
}

#[test]
fn a_timed_gap_ending_mid_day_fetches_through_that_date() {
    let coverage = [CalendarSpan {
        kind: SpanKind::Timed,
        start: ms("2026-11-10T15:00:00Z"),
        end: ms("2026-12-01T00:00:00Z"),
    }];
    let windows = calendar_windows(Tz::UTC, &coverage, at("2026-11-02T12:00:00Z"), 0, 10);
    assert_eq!(windows[0].input["endDate"], "2026-11-11");
}

#[test]
fn the_budget_keeps_the_nearest_windows() {
    let windows = calendar_windows(Tz::UTC, &[], at("2026-11-02T12:00:00Z"), 12, 3);
    assert_eq!(starts(&windows), ["2026-11-01", "2026-12-01", "2026-10-01"]);
    assert!(calendar_windows(Tz::UTC, &[], at("2026-11-02T12:00:00Z"), 12, 0).is_empty());
}

#[test]
fn a_skipped_midnight_starts_at_the_first_local_time_after_it() {
    // Daylight time began at midnight in São Paulo on 2018-11-04.
    assert_eq!(
        local_midnight(Tz::America__Sao_Paulo, date("2018-11-04")),
        at("2018-11-04T03:00:00Z")
    );
    assert_eq!(
        local_midnight(Tz::America__Sao_Paulo, date("2018-11-05")),
        at("2018-11-05T02:00:00Z")
    );
}

#[test]
fn epoch_days_round_trip() {
    assert_eq!(epoch_day(date("1970-01-01")), 0);
    assert_eq!(epoch_day(date("2026-11-01")), 20_758);
    assert_eq!(epoch_day_date(20_758), Some(date("2026-11-01")));
    assert_eq!(epoch_day_date(-1), Some(date("1969-12-31")));
}
