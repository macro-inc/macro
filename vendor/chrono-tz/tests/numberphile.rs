//! Unit tests derived from Tom Scott's video on Numberphile,
//! [`The Problem with Time & Timezones'][video].
//! Note that not all tests are passing; the ones towards
//! the end of the video are not handled correctly (nor are
//! currently intended to be handled correctly) by chrono.
//!
//! [video]: https://www.youtube.com/watch?v=-5wpm-gesOY

use chrono::{DateTime, NaiveDate, TimeZone};

use chrono_tz::Africa::Tripoli;
use chrono_tz::America::New_York;
use chrono_tz::Asia::Gaza;
use chrono_tz::Asia::Jerusalem;
use chrono_tz::Asia::Kathmandu;
use chrono_tz::Australia::Adelaide;
use chrono_tz::Etc::UTC;
use chrono_tz::Europe::London;
use chrono_tz::Europe::Moscow;
use chrono_tz::Pacific::Apia;

fn seconds<Tz1: TimeZone, Tz2: TimeZone>(from: DateTime<Tz1>, to: DateTime<Tz2>) -> i64 {
    to.signed_duration_since(from).num_seconds()
}

#[test]
fn london_5_days_ago_to_new_york() {
    let from = London.with_ymd_and_hms(2013, 12, 25, 14, 0, 0).unwrap();
    let to = New_York.with_ymd_and_hms(2013, 12, 30, 14, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60 * (24 * 5 + 5));
}

#[test]
fn london_to_australia() {
    // at the time Tom was speaking, Adelaide was 10 1/2 hours ahead
    // many other parts of Australia use different time zones
    let from = London.with_ymd_and_hms(2013, 12, 25, 14, 0, 0).unwrap();
    let to = Adelaide.with_ymd_and_hms(2013, 12, 30, 14, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60 * (24 * 5 - 10) - 60 * 30);
}

#[test]
fn london_to_nepal() {
    // note Tom gets this wrong, it's 5 3/4 hours as he is speaking
    let from = London.with_ymd_and_hms(2013, 12, 25, 14, 0, 0).unwrap();
    let to = Kathmandu.with_ymd_and_hms(2013, 12, 30, 14, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60 * (24 * 5 - 5) - 60 * 45);
}

#[test]
fn autumn() {
    let from = London.with_ymd_and_hms(2013, 10, 25, 12, 0, 0).unwrap();
    let to = London.with_ymd_and_hms(2013, 11, 1, 12, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60 * (24 * 7 + 1));
}

#[test]
fn earlier_daylight_savings_in_new_york() {
    let from = New_York.with_ymd_and_hms(2013, 10, 25, 12, 0, 0).unwrap();
    let to = New_York.with_ymd_and_hms(2013, 11, 1, 12, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60 * (24 * 7));
}

#[test]
fn southern_hemisphere_clocks_forward() {
    let from = Adelaide.with_ymd_and_hms(2013, 10, 1, 12, 0, 0).unwrap();
    let to = Adelaide.with_ymd_and_hms(2013, 11, 1, 12, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60 * (24 * 31 - 1));
}

#[test]
fn samoa_skips_a_day() {
    let from = Apia.with_ymd_and_hms(2011, 12, 29, 12, 0, 0).unwrap();
    let to = Apia.with_ymd_and_hms(2011, 12, 31, 12, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60 * 24);
}

#[test]
fn double_bst() {
    let from = London.with_ymd_and_hms(1942, 6, 1, 12, 0, 0).unwrap();
    let to = UTC.with_ymd_and_hms(1942, 6, 1, 12, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60 * 2);
}

#[test]
fn libya_2013() {
    // Libya actually put their clocks *forward* in 2013, but not in any other year
    let from = Tripoli.with_ymd_and_hms(2012, 3, 1, 12, 0, 0).unwrap();
    let to = Tripoli.with_ymd_and_hms(2012, 4, 1, 12, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60 * 24 * 31);

    let from = Tripoli.with_ymd_and_hms(2013, 3, 1, 12, 0, 0).unwrap();
    let to = Tripoli.with_ymd_and_hms(2013, 4, 1, 12, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60 * (24 * 31 - 1));

    let from = Tripoli.with_ymd_and_hms(2014, 3, 1, 12, 0, 0).unwrap();
    let to = Tripoli.with_ymd_and_hms(2014, 4, 1, 12, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60 * 24 * 31);
}

#[test]
fn israel_palestine() {
    let from = Jerusalem.with_ymd_and_hms(2016, 10, 29, 12, 0, 0).unwrap();
    let to = Gaza.with_ymd_and_hms(2016, 10, 29, 12, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60);
}

// FIXME doesn't currently work!
#[test]
#[ignore]
fn london_julian_to_gregorian() {
    let from = London.with_ymd_and_hms(1752, 9, 2, 12, 0, 0).unwrap();
    let to = London.with_ymd_and_hms(1752, 9, 14, 12, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60 * 24);
}

// FIXME doesn't currently work!
#[test]
#[ignore]
fn russian_julian_to_gregorian() {
    let from = Moscow.with_ymd_and_hms(1918, 1, 31, 12, 0, 0).unwrap();
    let to = Moscow.with_ymd_and_hms(1918, 2, 14, 12, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60 * 24);
}

// FIXME doesn't currently work!
#[test]
#[ignore]
fn london_25_march() {
    let from = London.with_ymd_and_hms(924, 3, 24, 12, 0, 0).unwrap();
    let to = London.with_ymd_and_hms(925, 3, 25, 12, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 60 * 60 * 24);
}

#[test]
fn leapsecond() {
    let from = UTC.with_ymd_and_hms(2016, 6, 30, 23, 59, 59).unwrap();
    let leap = NaiveDate::from_ymd_opt(2016, 6, 30)
        .unwrap()
        .and_hms_milli_opt(23, 59, 59, 1000)
        .unwrap();
    let to = UTC.from_local_datetime(&leap).unwrap();
    assert_eq!(seconds(from, to), 1);
}

// FIXME doesn't currently work!
#[test]
#[ignore]
fn leapsecond_2() {
    let from = UTC.with_ymd_and_hms(2016, 6, 30, 23, 59, 59).unwrap();
    let to = UTC.with_ymd_and_hms(2016, 7, 1, 0, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 2);
}

// FIXME doesn't currently work!
#[test]
#[ignore]
fn leapsecond_3() {
    let leap = NaiveDate::from_ymd_opt(2016, 6, 30)
        .unwrap()
        .and_hms_milli_opt(23, 59, 59, 1000)
        .unwrap();
    let from = UTC.from_local_datetime(&leap).unwrap();
    let to = UTC.with_ymd_and_hms(2016, 7, 1, 0, 0, 0).unwrap();
    assert_eq!(seconds(from, to), 1);
}
