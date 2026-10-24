use super::*;

#[test]
fn deadline_groups_use_explicit_utc_day_starts_across_dst() {
    let at = |s: &str| s.parse::<DateTime<Utc>>().unwrap();
    // New York enters daylight-saving time on March 8, 2026.
    let boundaries = DeadlineBoundaries {
        today: at("2026-03-08T05:00:00Z"),
        tomorrow: at("2026-03-09T04:00:00Z"),
        day_two: at("2026-03-10T04:00:00Z"),
        day_eight: at("2026-03-16T04:00:00Z"),
    };
    assert!(boundaries.is_valid());
    assert_eq!(boundaries.key(Some(at("2026-03-08T04:59:59Z"))), "overdue");
    assert_eq!(boundaries.key(Some(boundaries.today)), "today");
    assert_eq!(boundaries.key(Some(at("2026-03-09T03:59:59Z"))), "today");
    assert_eq!(boundaries.key(Some(boundaries.tomorrow)), "tomorrow");
    assert_eq!(boundaries.key(Some(boundaries.day_two)), "next_7_days");
    assert_eq!(
        boundaries.key(Some(at("2026-03-16T03:59:59Z"))),
        "next_7_days"
    );
    assert_eq!(boundaries.key(Some(boundaries.day_eight)), "later");
    assert_eq!(boundaries.key(None), "");
}
