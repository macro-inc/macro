use chrono::TimeZone;
use chrono_tz::Asia::Tokyo;

use macro_user_id::cowlike::CowLike as _;

use super::*;

fn user(n: u32) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|night{n}@macro.com"))
        .unwrap()
        .into_owned()
}

fn tokyo(day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
    Tokyo
        .with_ymd_and_hms(2026, 11, day, hour, minute, 0)
        .unwrap()
        .with_timezone(&Utc)
}

/// Each person has one time a night, inside the night's first hours, the
/// same every night; people spread over the night.
#[test]
fn each_person_is_due_once_a_night_at_their_own_time() {
    let at = |n: u32, day: u32| following(&user(n), Tokyo, tokyo(day - 1, 12, 0));
    for n in 0..50 {
        let tonight = at(n, 11).with_timezone(&Tokyo);
        assert!(in_night(Tokyo, at(n, 11)), "{tonight}");
        assert!(tonight.hour() < u32::from(NIGHT.1) - 1, "{tonight}");
        assert_eq!(
            at(n, 12) - at(n, 11),
            TimeDelta::days(1),
            "same time each night"
        );
    }
    let distinct: std::collections::HashSet<_> = (0..50).map(|n| at(n, 11)).collect();
    assert!(distinct.len() > 20, "spread over the night");
}

/// Seen in the evening: tonight. Seen during the night after their time:
/// now. Seen in the morning: the next night. After a run: the next night.
#[test]
fn a_person_is_due_tonight_or_the_next_night() {
    let person = user(1);
    let tonight = following(&person, Tokyo, tokyo(10, 20, 0));
    assert_eq!(upcoming(&person, Tokyo, tokyo(10, 20, 0)), tonight);
    let late = tokyo(11, 4, 30);
    assert!(late > tonight);
    assert_eq!(upcoming(&person, Tokyo, late), late);
    let morning = upcoming(&person, Tokyo, tokyo(11, 9, 0));
    assert_eq!(morning - tonight, TimeDelta::days(1));
    assert_eq!(following(&person, Tokyo, tonight), morning);
    assert!(!in_night(Tokyo, tokyo(11, 9, 0)));
}
