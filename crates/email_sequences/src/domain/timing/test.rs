use super::*;
use chrono::{NaiveTime, TimeZone};
use chrono_tz::{America::New_York, Asia::Kolkata};

fn utc(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(y, m, d, h, min, 0).unwrap()
}

fn clock(timezone: chrono_tz::Tz, h: u32, m: u32) -> SendClock {
    SendClock {
        timezone,
        send_time: NaiveTime::from_hms_opt(h, m, 0).unwrap(),
    }
}

#[test]
fn next_due_table() {
    let long_ago = utc(2026, 1, 1, 0, 0);
    let cases = [
        (
            "two days later at the send time",
            utc(2026, 6, 1, 13, 0),
            2,
            clock(New_York, 9, 0),
            long_ago,
            utc(2026, 6, 3, 13, 0),
        ),
        (
            "spring forward: 02:30 does not exist, moves to 03:00",
            utc(2026, 3, 7, 7, 30),
            1,
            clock(New_York, 2, 30),
            long_ago,
            utc(2026, 3, 8, 7, 0),
        ),
        (
            "fall back: 01:30 happens twice, takes the earlier",
            utc(2026, 10, 31, 5, 30),
            1,
            clock(New_York, 1, 30),
            long_ago,
            utc(2026, 11, 1, 5, 30),
        ),
        (
            "local date, not UTC date: 23:30 local is the next UTC day",
            utc(2026, 6, 2, 3, 30),
            1,
            clock(New_York, 23, 30),
            long_ago,
            utc(2026, 6, 3, 3, 30),
        ),
        (
            "half-hour zones keep their offset",
            utc(2026, 6, 1, 3, 30),
            3,
            clock(Kolkata, 9, 0),
            long_ago,
            utc(2026, 6, 4, 3, 30),
        ),
        (
            "a 23:59 step whose slot slipped past midnight keeps its day",
            utc(2026, 6, 2, 4, 1),
            1,
            clock(New_York, 23, 59),
            long_ago,
            utc(2026, 6, 3, 3, 59),
        ),
        (
            "and a 0-day step after it follows minutes later, not a day",
            utc(2026, 6, 2, 4, 1),
            0,
            clock(New_York, 23, 59),
            utc(2026, 6, 2, 4, 2),
            utc(2026, 6, 2, 4, 4),
        ),
        (
            "a step sent earlier in the day than the send time still waits a day",
            utc(2026, 6, 1, 12, 0),
            1,
            clock(New_York, 9, 0),
            long_ago,
            utc(2026, 6, 2, 13, 0),
        ),
        (
            "a 0-day step is floored to now + lead time",
            utc(2026, 6, 1, 13, 0),
            0,
            clock(New_York, 9, 0),
            utc(2026, 6, 1, 13, 1),
            utc(2026, 6, 1, 13, 3),
        ),
        (
            "a backlog past the due time is floored too",
            utc(2026, 6, 1, 13, 0),
            1,
            clock(New_York, 9, 0),
            utc(2026, 6, 9, 0, 0),
            utc(2026, 6, 9, 0, 2),
        ),
    ];
    for (name, previous, days, clock, now, expected) in cases {
        assert_eq!(next_due(previous, days, clock, now), expected, "{name}");
    }
}

#[test]
fn first_due_never_before_lead_time() {
    let now = utc(2026, 6, 1, 12, 0);
    assert_eq!(first_due(now, now), utc(2026, 6, 1, 12, 2));
    assert_eq!(first_due(utc(2026, 6, 5, 9, 0), now), utc(2026, 6, 5, 9, 0));
}

#[test]
fn send_clock_is_the_local_time_of_the_start() {
    let clock = send_clock(utc(2026, 6, 1, 13, 15), New_York);
    assert_eq!(clock.send_time, NaiveTime::from_hms_opt(9, 15, 0).unwrap());
}
