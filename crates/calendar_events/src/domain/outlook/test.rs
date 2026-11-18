use super::*;
use chrono::{DateTime, TimeDelta, TimeZone, Utc};

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 17, 12, 0, 0).unwrap()
}

fn member(provider_id: &str, master_id: &str, hours_from_now: i64) -> OutlookPageMember {
    let starts_at = now() + TimeDelta::hours(hours_from_now);
    OutlookPageMember {
        provider_id: provider_id.into(),
        master_id: master_id.into(),
        occurs: Some((starts_at, starts_at + TimeDelta::hours(1))),
    }
}

#[test]
fn the_near_window_reads_the_events_closest_to_now_first() {
    let mut under_way = member("under-way", "under-way", -2);
    under_way.occurs = under_way
        .occurs
        .map(|(starts_at, _)| (starts_at, now() + TimeDelta::days(3)));
    let untimed = OutlookPageMember {
        occurs: None,
        ..member("untimed", "untimed", 0)
    };
    let members = vec![
        member("a-next-month", "a-next-month", 24 * 30),
        untimed,
        member("b-yesterday", "b-yesterday", -24),
        member("series-in-a-week", "series", 24 * 7),
        member("series-tomorrow", "series", 24),
        member("c-in-two-days", "c-in-two-days", 48),
        under_way,
    ];

    assert_eq!(
        nearest_first(&members, now()),
        [
            "under-way",
            "b-yesterday",
            "series",
            "c-in-two-days",
            "a-next-month",
            "untimed",
        ],
        "an event under way, then by distance from now in either direction, \
        a series by its nearest occurrence, and an untimed member last"
    );
}

#[test]
fn equally_near_events_and_untimed_ones_keep_id_order() {
    let untimed = |id: &str| OutlookPageMember {
        provider_id: id.into(),
        master_id: id.into(),
        occurs: None,
    };
    let members = vec![
        untimed("z-untimed"),
        member("b-in-an-hour", "b-in-an-hour", 1),
        untimed("y-untimed"),
        member("a-in-an-hour", "a-in-an-hour", 1),
    ];

    assert_eq!(
        nearest_first(&members, now()),
        ["a-in-an-hour", "b-in-an-hour", "y-untimed", "z-untimed"]
    );
}
