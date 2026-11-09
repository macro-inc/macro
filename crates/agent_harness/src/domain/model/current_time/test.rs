use super::*;
use chrono::TimeZone;

/// 20:03 UTC is still the afternoon of the same day in New York, so a chip
/// for "today" must carry the New York date, not UTC midnight.
#[test]
fn states_now_in_the_users_time_zone() {
    let now = Utc.with_ymd_and_hms(2026, 9, 24, 20, 3, 36).unwrap();

    assert_eq!(
        CurrentTime::new(now, Some("America/New_York")),
        CurrentTime {
            iso: "2026-09-24T16:03:36-04:00".to_owned(),
            local: "Thursday, September 24, 2026, 4:03 PM".to_owned(),
            time_zone: Some("America/New_York".to_owned()),
        }
    );
}

#[test]
fn crosses_midnight_into_the_users_date() {
    let now = Utc.with_ymd_and_hms(2026, 9, 25, 2, 30, 0).unwrap();

    assert_eq!(
        CurrentTime::new(now, Some("America/Los_Angeles")),
        CurrentTime {
            iso: "2026-09-24T19:30:00-07:00".to_owned(),
            local: "Thursday, September 24, 2026, 7:30 PM".to_owned(),
            time_zone: Some("America/Los_Angeles".to_owned()),
        }
    );
}

#[test]
fn falls_back_to_utc_without_a_known_zone() {
    let now = Utc.with_ymd_and_hms(2026, 9, 24, 20, 3, 36).unwrap();
    let utc = CurrentTime {
        iso: "2026-09-24T20:03:36+00:00".to_owned(),
        local: "Thursday, September 24, 2026, 8:03 PM".to_owned(),
        time_zone: None,
    };

    assert_eq!(CurrentTime::new(now, None), utc);
    assert_eq!(CurrentTime::new(now, Some("Mars/Olympus_Mons")), utc);
}
