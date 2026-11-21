//! Expanded-interval window arithmetic with P=30s and m=2s, window [60,90).
use crate::domain::agent::totp::{valid_for_ms, window_cutoff};
use chrono::{DateTime, Utc};

fn at(milliseconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp_millis(milliseconds).unwrap()
}

#[test]
fn accepts_only_brackets_whose_expanded_interval_fits_one_window() {
    // Interior: E is the window end minus the margin, never t1 + period.
    assert_eq!(window_cutoff(at(70_000), at(70_200), 30), Some(at(88_000)));
    // The expanded lower edge may sit exactly on the window start.
    assert_eq!(window_cutoff(at(62_000), at(62_100), 30), Some(at(88_000)));
    // A provider lagging early in a window could still be on the previous counter.
    assert_eq!(window_cutoff(at(60_500), at(60_800), 30), None);
    // The expanded upper edge on the boundary belongs to the next window.
    assert_eq!(window_cutoff(at(87_900), at(88_000), 30), None);
    // A long call spanning a boundary.
    assert_eq!(window_cutoff(at(70_000), at(95_000), 30), None);
    // Inverted samples and a period too short for the margin fail closed.
    assert_eq!(window_cutoff(at(70_200), at(70_000), 30), None);
    assert_eq!(window_cutoff(at(70_000), at(70_200), 4), None);
}

#[test]
fn remaining_lifetime_rounds_down_and_fails_closed() {
    assert_eq!(valid_for_ms(at(88_000), at(71_250), 30), Some(16_750));
    assert_eq!(
        valid_for_ms(
            at(88_000),
            DateTime::from_timestamp_nanos(71_250_400_000),
            30
        ),
        Some(16_749)
    );
    assert_eq!(valid_for_ms(at(88_000), at(88_000), 30), None);
    assert_eq!(valid_for_ms(at(88_000), at(89_000), 30), None);
    assert_eq!(
        valid_for_ms(
            at(88_000),
            DateTime::from_timestamp_nanos(87_999_500_000),
            30
        ),
        None
    );
    assert_eq!(valid_for_ms(at(120_000), at(60_000), 30), None);
}
