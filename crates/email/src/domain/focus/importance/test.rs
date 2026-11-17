use chrono::{Duration, TimeZone};

use super::*;

fn since() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 1, 12, 0, 0).unwrap()
}

fn after_days(days: i64) -> DateTime<Utc> {
    since() + Duration::days(days)
}

#[test]
fn flat_threads_never_move() {
    for days in [0, 1, 30, 90, 3650] {
        assert_eq!(importance_at(72, 0, since(), after_days(days)), 72);
    }
}

#[test]
fn nothing_moves_before_any_time_passes() {
    for rate in [-10, -1, 0, 1, 10] {
        assert_eq!(importance_at(40, rate, since(), since()), 40);
    }
}

#[test]
fn a_message_dated_in_the_future_counts_as_no_time() {
    for rate in [-10, 10] {
        assert_eq!(importance_at(40, rate, after_days(3), since()), 40);
    }
}

#[test]
fn each_day_covers_a_share_of_the_distance_left() {
    assert_eq!(importance_at(50, 10, since(), after_days(1)), 55);
    assert_eq!(importance_at(50, 10, since(), after_days(2)), 60);
    assert_eq!(importance_at(50, -10, since(), after_days(1)), 45);
    assert_eq!(importance_at(50, -10, since(), after_days(2)), 41);
}

#[test]
fn it_moves_within_a_day_too() {
    let twelve_hours = since() + Duration::hours(12);
    assert_eq!(importance_at(50, 10, since(), twelve_hours), 53);
    assert_eq!(importance_at(50, -10, since(), twelve_hours), 47);
}

#[test]
fn it_moves_steadily_towards_its_end_and_never_past_it() {
    for rate in [1, 4, 10, 100, i8::MAX] {
        let mut last = 30;
        for days in 0..=365 {
            let now = importance_at(30, rate, since(), after_days(days));
            assert!(now >= last && now <= 100, "rate {rate} day {days}: {now}");
            last = now;
        }
    }
    for rate in [-1, -4, -10, -100, i8::MIN] {
        let mut last = 30;
        for days in 0..=365 {
            let now = importance_at(30, rate, since(), after_days(days));
            assert!(now <= last, "rate {rate} day {days}: {now}");
            last = now;
        }
    }
}

#[test]
fn mid_range_threads_keep_their_order_over_the_list_window() {
    // Moving as fast as a thread can, these don't reach either end within the 30
    // days the list covers. Bases already close to an end do, after rounding.
    let lower = importance_at(40, 10, since(), after_days(30));
    let higher = importance_at(70, 10, since(), after_days(30));
    assert!(lower < higher && higher < 100, "{lower} {higher}");

    let lower = importance_at(40, -10, since(), after_days(30));
    let higher = importance_at(70, -10, since(), after_days(30));
    assert!(0 < lower && lower < higher, "{lower} {higher}");
}

#[test]
fn fading_can_go_below_the_floors_that_set_the_base() {
    // A thread needing a reply starts at the 70 floor at least; time may take it lower.
    assert_eq!(importance_at(70, -10, since(), after_days(14)), 16);
}

#[test]
fn a_base_outside_the_scale_reads_as_its_top() {
    assert_eq!(importance_at(200, 0, since(), after_days(1)), 100);
    assert_eq!(importance_at(200, 10, since(), after_days(1)), 100);
}

#[test]
fn the_trend_follows_the_rate() {
    assert_eq!(ImportanceTrend::of(4, 50), ImportanceTrend::Up);
    assert_eq!(ImportanceTrend::of(-4, 50), ImportanceTrend::Down);
    assert_eq!(ImportanceTrend::of(0, 50), ImportanceTrend::Flat);
}

#[test]
fn the_trend_is_flat_once_there_is_nowhere_left_to_go() {
    assert_eq!(ImportanceTrend::of(4, 100), ImportanceTrend::Flat);
    assert_eq!(ImportanceTrend::of(-4, 0), ImportanceTrend::Flat);
    // It can still leave the end it isn't heading for.
    assert_eq!(ImportanceTrend::of(4, 0), ImportanceTrend::Up);
    assert_eq!(ImportanceTrend::of(-4, 100), ImportanceTrend::Down);
}
