use chrono::{DateTime, TimeZone, Utc};

use super::*;

fn rfc3339(text: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|instant| instant.with_timezone(&Utc))
}

#[test]
fn an_interval_reads_as_its_two_ends_in_order() {
    assert_eq!(
        DateRange::parse_interval("2026-03-02T00:00:00Z/2026-03-06T12:00:00Z", rfc3339),
        Some(DateRange {
            start: Utc.with_ymd_and_hms(2026, 3, 2, 0, 0, 0).unwrap(),
            end: Utc.with_ymd_and_hms(2026, 3, 6, 12, 0, 0).unwrap(),
        })
    );
    assert_eq!(
        DateRange::parse_interval("2026-03-06T00:00:00Z/2026-03-02T00:00:00Z", rfc3339),
        None
    );
    assert_eq!(
        DateRange::parse_interval("2026-03-02T00:00:00Z", rfc3339),
        None
    );
    assert_eq!(
        DateRange::parse_interval("2026-03-02T00:00:00Z/", rfc3339),
        None
    );
    assert_eq!(
        DateRange::parse_interval(
            "2026-03-02T00:00:00Z/2026-03-03T00:00:00Z/2026-03-04T00:00:00Z",
            rfc3339
        ),
        None
    );
    assert_eq!(DateRange::parse_interval("soon/later", rfc3339), None);
}
