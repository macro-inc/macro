use std::num::NonZeroU64;

use activity::ActivityWindow;
use chrono::NaiveDate;

use super::*;

fn date(value: &str) -> NaiveDate {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("valid test date")
}

fn count(value: u64) -> NonZeroU64 {
    NonZeroU64::new(value).expect("positive test count")
}

fn window() -> ActivityWindow {
    ActivityWindow::new(
        chrono_tz::America::Havana,
        date("2026-03-07"),
        date("2026-03-10"),
    )
    .unwrap()
}

#[test]
fn omitted_and_empty_time_zones_use_utc() {
    assert_eq!(parse_time_zone(None).unwrap(), chrono_tz::UTC);
    assert_eq!(
        parse_time_zone(Some(String::new())).unwrap(),
        chrono_tz::UTC
    );
}

#[test]
fn invalid_time_zones_are_client_errors() {
    let error = parse_time_zone(Some("Not/AZone".to_owned())).unwrap_err();
    assert_eq!(
        error.message,
        "invalid timeZone: expected an IANA zone name"
    );
}

#[test]
fn overview_projection_preserves_the_domain_window_and_order() {
    let overview = ActivityOverview::new(
        window(),
        vec![
            DayCount {
                day: date("2026-03-07"),
                count: count(2),
            },
            DayCount {
                day: date("2026-03-09"),
                count: count(3),
            },
        ],
        vec![EntityRank {
            entity_type: activity::EntityType::Document,
            entity_id: "doc-1".to_owned(),
            count: count(5),
        }],
    )
    .unwrap();

    let projected = GraphqlActivityOverview::try_from(overview).unwrap();

    assert_eq!(projected.from, "2026-03-07");
    assert_eq!(projected.to, "2026-03-10");
    assert_eq!(projected.time_zone, "America/Havana");
    assert_eq!(projected.total, 5);
    assert_eq!(projected.days[0].date, "2026-03-07");
    assert_eq!(projected.days[1].date, "2026-03-09");
    assert_eq!(projected.top_entities[0].entity_id.as_str(), "doc-1");
}

#[test]
fn counts_larger_than_graphql_int_are_rejected() {
    let overview = ActivityOverview::new(
        window(),
        vec![DayCount {
            day: date("2026-03-07"),
            count: count(i32::MAX as u64 + 1),
        }],
        Vec::new(),
    )
    .unwrap();

    assert!(GraphqlActivityOverview::try_from(overview).is_err());
}
