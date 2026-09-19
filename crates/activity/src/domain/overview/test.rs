use chrono::{NaiveDate, TimeZone};

use super::*;

fn date(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).expect("valid test date")
}

fn count(value: u64) -> NonZeroU64 {
    NonZeroU64::new(value).expect("positive test count")
}

fn window() -> ActivityWindow {
    ActivityWindow::new(chrono_tz::UTC, date(2026, 1, 1), date(2026, 1, 4)).unwrap()
}

fn rank(entity_id: &str, value: u64) -> EntityRank {
    EntityRank {
        entity_type: EntityType::Document,
        entity_id: entity_id.to_owned(),
        count: count(value),
    }
}

#[test]
fn windows_reject_empty_reversed_and_overwide_spans() {
    let start = date(2026, 1, 1);

    assert_eq!(
        ActivityWindow::new(chrono_tz::UTC, start, start),
        Err(ActivityWindowError::Empty)
    );
    assert_eq!(
        ActivityWindow::new(chrono_tz::UTC, start, date(2025, 12, 31)),
        Err(ActivityWindowError::Empty)
    );
    assert_eq!(
        ActivityWindow::new(
            chrono_tz::UTC,
            start,
            start + chrono::Duration::days(MAX_ACTIVITY_WINDOW_DAYS + 1),
        ),
        Err(ActivityWindowError::TooWide)
    );
    assert!(
        ActivityWindow::new(
            chrono_tz::UTC,
            start,
            start + chrono::Duration::days(MAX_ACTIVITY_WINDOW_DAYS),
        )
        .is_ok()
    );
}

#[test]
fn trailing_year_uses_the_viewers_local_date() {
    let now = Utc.with_ymd_and_hms(2026, 1, 1, 1, 30, 0).unwrap();
    let window = trailing_year(now, chrono_tz::America::Los_Angeles);

    assert_eq!(window.end, date(2026, 1, 1));
    assert_eq!(window.start, date(2025, 1, 1));
    assert_eq!(
        window.end.signed_duration_since(window.start).num_days(),
        365
    );
}

#[test]
fn overview_is_sparse_ordered_bounded_and_totals_its_days() {
    let overview = ActivityOverview::new(
        window(),
        vec![
            DayCount {
                day: date(2026, 1, 1),
                count: count(2),
            },
            DayCount {
                day: date(2026, 1, 3),
                count: count(5),
            },
        ],
        vec![rank("a", 5), rank("b", 2)],
    )
    .unwrap();

    assert_eq!(overview.total(), 7);
    assert_eq!(overview.days.len(), 2);
}

#[test]
fn overview_rejects_days_outside_or_not_strictly_ascending() {
    let outside = ActivityOverview::new(
        window(),
        vec![DayCount {
            day: date(2026, 1, 4),
            count: count(1),
        }],
        Vec::new(),
    );
    assert_eq!(outside, Err(ActivityOverviewError::DayOutsideWindow));

    let repeated = ActivityOverview::new(
        window(),
        vec![
            DayCount {
                day: date(2026, 1, 2),
                count: count(1),
            },
            DayCount {
                day: date(2026, 1, 2),
                count: count(2),
            },
        ],
        Vec::new(),
    );
    assert_eq!(repeated, Err(ActivityOverviewError::DaysNotAscending));
}

#[test]
fn overview_rejects_invalid_rankings_and_total_overflow() {
    let unsorted = ActivityOverview::new(window(), Vec::new(), vec![rank("a", 1), rank("b", 2)]);
    assert_eq!(unsorted, Err(ActivityOverviewError::EntitiesNotRanked));

    let too_many = ActivityOverview::new(
        window(),
        Vec::new(),
        (0..=TOP_ENTITY_LIMIT)
            .map(|index| rank(&format!("{index:02}"), 1))
            .collect(),
    );
    assert_eq!(too_many, Err(ActivityOverviewError::TooManyEntities));

    let overflow = ActivityOverview::new(
        window(),
        vec![
            DayCount {
                day: date(2026, 1, 1),
                count: count(u64::MAX),
            },
            DayCount {
                day: date(2026, 1, 2),
                count: count(1),
            },
        ],
        Vec::new(),
    );
    assert_eq!(overflow, Err(ActivityOverviewError::TotalOverflow));
}
