use chrono::NaiveDate;
use serde_json::json;

use super::{InvalidRecurrence, LocalTime, Recurrence};

fn date(text: &str) -> NaiveDate {
    text.parse().unwrap()
}

fn dates(recurrence: serde_json::Value, until: &str) -> Vec<String> {
    let recurrence = Recurrence::parse(&recurrence).unwrap();
    let dates = recurrence.dates(date(until));
    dates.iter().map(ToString::to_string).collect()
}

#[test]
fn a_weekly_pattern_falls_on_its_days_every_other_week() {
    let found = dates(
        json!({
            "pattern": {"type": "weekly", "interval": 2, "daysOfWeek": ["monday", "thursday"], "firstDayOfWeek": "sunday"},
            "range": {"type": "noEnd", "startDate": "2026-11-05"},
        }),
        "2026-11-30",
    );
    // The series starts on a Thursday, so the Monday of that week is before it.
    assert_eq!(
        found,
        vec!["2026-11-05", "2026-11-16", "2026-11-19", "2026-11-30"]
    );
}

#[test]
fn a_numbered_range_stops_after_its_count_and_an_end_date_on_its_day() {
    let numbered = dates(
        json!({
            "pattern": {"type": "daily", "interval": 3},
            "range": {"type": "numbered", "startDate": "2026-11-01", "numberOfOccurrences": 3},
        }),
        "2027-01-01",
    );
    assert_eq!(numbered, vec!["2026-11-01", "2026-11-04", "2026-11-07"]);

    let ended = dates(
        json!({
            "pattern": {"type": "daily", "interval": 1},
            "range": {"type": "endDate", "startDate": "2026-11-01", "endDate": "2026-11-03"},
        }),
        "2027-01-01",
    );
    assert_eq!(ended, vec!["2026-11-01", "2026-11-02", "2026-11-03"]);
}

#[test]
fn monthly_and_yearly_patterns_find_their_day() {
    let absolute = dates(
        json!({
            "pattern": {"type": "absoluteMonthly", "interval": 1, "dayOfMonth": 31},
            "range": {"type": "noEnd", "startDate": "2027-01-31"},
        }),
        "2027-04-30",
    );
    // A month too short for the day gives its last day.
    assert_eq!(
        absolute,
        vec!["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]
    );

    let relative = dates(
        json!({
            "pattern": {"type": "relativeMonthly", "interval": 1, "daysOfWeek": ["friday"], "index": "last"},
            "range": {"type": "noEnd", "startDate": "2026-11-27"},
        }),
        "2027-01-31",
    );
    assert_eq!(relative, vec!["2026-11-27", "2026-12-25", "2027-01-29"]);

    let yearly = dates(
        json!({
            "pattern": {"type": "absoluteYearly", "interval": 1, "dayOfMonth": 4, "month": 7},
            "range": {"type": "noEnd", "startDate": "2026-07-04"},
        }),
        "2028-12-31",
    );
    assert_eq!(yearly, vec!["2026-07-04", "2027-07-04", "2028-07-04"]);
}

#[test]
fn a_pattern_graph_would_refuse_is_named() {
    let no_days = json!({
        "pattern": {"type": "weekly", "interval": 1, "daysOfWeek": []},
        "range": {"type": "noEnd", "startDate": "2026-11-05"},
    });
    assert_eq!(
        Recurrence::parse(&no_days),
        Err(InvalidRecurrence("pattern.daysOfWeek"))
    );
}

#[test]
fn a_local_time_is_read_in_its_zone() {
    let winter = LocalTime::parse(
        &json!({"dateTime": "2026-11-09T10:00:00", "timeZone": "America/Los_Angeles"}),
    );
    assert_eq!(
        winter.unwrap().instant().to_rfc3339(),
        "2026-11-09T18:00:00+00:00"
    );

    let summer = LocalTime::parse(
        &json!({"dateTime": "2026-07-09T10:00:00.0000000", "timeZone": "America/Los_Angeles"}),
    );
    assert_eq!(
        summer.unwrap().instant().to_rfc3339(),
        "2026-07-09T17:00:00+00:00"
    );

    // A Windows name is not something the emulator computes with.
    let windows = json!({"dateTime": "2026-11-09T10:00:00", "timeZone": "Pacific Standard Time"});
    assert_eq!(LocalTime::parse(&windows), None);
}
