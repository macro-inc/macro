use chrono::TimeZone as _;
use chrono_tz::Tz;
use macro_user_id::cowlike::CowLike as _;
use strum::IntoEnumIterator as _;

use super::*;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|nightly@macro.com")
        .unwrap()
        .into_owned()
}

fn member(timezone: Tz, seen_at: DateTime<Utc>) -> AudienceMember {
    AudienceMember {
        user: user(),
        timezone,
        seen_at,
    }
}

fn utc(month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, month, day, hour, minute, 0)
        .unwrap()
}

/// The decision, written out: drop the inactive, miss outside the night,
/// wait without room, then by plan.
fn expected(active: bool, night: bool, room: usize, plan: Option<Plan>) -> NightlyDecision {
    match (active, night, room, plan) {
        (false, _, _, _) => NightlyDecision::Drop,
        (true, false, _, _) => NightlyDecision::Miss,
        (true, true, 0, _) => NightlyDecision::Wait,
        (true, true, _, Some(Plan::Paid)) => NightlyDecision::Start,
        (true, true, _, Some(Plan::Unpaid)) => NightlyDecision::Drop,
        (true, true, _, Some(Plan::Unknown) | None) => NightlyDecision::Retry,
    }
}

/// Instants around each zone's night, across both clock changes where the
/// zone has them, with whether each is in the zone's night (2 to 5 am).
fn instants() -> Vec<(Tz, DateTime<Utc>, bool)> {
    use chrono_tz::{America, Asia, Australia, Europe, Pacific};
    vec![
        // Tokyo, no clock change: 2 am is 17:00 UTC.
        (Asia::Tokyo, utc(11, 12, 16, 59), false),
        (Asia::Tokyo, utc(11, 12, 17, 0), true),
        (Asia::Tokyo, utc(11, 12, 19, 59), true),
        (Asia::Tokyo, utc(11, 12, 20, 0), false),
        // Kolkata, half an hour off: 2 am is 20:30 UTC the day before.
        (Asia::Kolkata, utc(11, 12, 20, 29), false),
        (Asia::Kolkata, utc(11, 12, 20, 30), true),
        (Asia::Kolkata, utc(11, 12, 23, 29), true),
        (Asia::Kolkata, utc(11, 12, 23, 30), false),
        // New York, spring forward on March 8: 2 am is skipped, the night
        // starts at 3 am EDT (07:00 UTC).
        (America::New_York, utc(3, 8, 6, 59), false),
        (America::New_York, utc(3, 8, 7, 0), true),
        (America::New_York, utc(3, 8, 8, 59), true),
        (America::New_York, utc(3, 8, 9, 0), false),
        // New York, fall back on November 1: 1 am repeats, 2 am EST is
        // 07:00 UTC.
        (America::New_York, utc(11, 1, 6, 30), false),
        (America::New_York, utc(11, 1, 7, 0), true),
        (America::New_York, utc(11, 1, 9, 59), true),
        (America::New_York, utc(11, 1, 10, 0), false),
        // London, fall back on October 25 at 2 am BST: 1 am repeats, the
        // night is 2 to 5 am GMT.
        (Europe::London, utc(10, 25, 1, 59), false),
        (Europe::London, utc(10, 25, 2, 0), true),
        (Europe::London, utc(10, 25, 4, 59), true),
        (Europe::London, utc(10, 25, 5, 0), false),
        // Lord Howe moves by half an hour (to +11 on October 4).
        (Australia::Lord_Howe, utc(10, 4, 14, 59), false),
        (Australia::Lord_Howe, utc(10, 4, 15, 0), true),
        (Australia::Lord_Howe, utc(10, 4, 17, 59), true),
        (Australia::Lord_Howe, utc(10, 4, 18, 0), false),
        // Chatham, 45 minutes off (+13:45 in its summer).
        (Pacific::Chatham, utc(11, 12, 12, 14), false),
        (Pacific::Chatham, utc(11, 12, 12, 15), true),
        (Pacific::Chatham, utc(11, 12, 15, 14), true),
        (Pacific::Chatham, utc(11, 12, 15, 15), false),
    ]
}

/// Every combination of activity, night, room and plan decides as the
/// table says, in every zone, across clock changes; the plan is needed only
/// where it decides.
#[test]
fn the_decision_follows_the_table_in_every_zone() {
    for (timezone, now, night) in instants() {
        assert_eq!(
            night::in_night(timezone, now),
            night,
            "{timezone} at {now} is {}",
            now.with_timezone(&timezone)
        );
        for active in [true, false] {
            let seen_at = if active {
                now - ACTIVE_WITHIN + TimeDelta::minutes(1)
            } else {
                now - ACTIVE_WITHIN
            };
            let member = member(timezone, seen_at);
            for room in [0, 1, 6] {
                let plans = Plan::iter().map(Some).chain([None]);
                for plan in plans {
                    assert_eq!(
                        decide(&member, now, room, plan),
                        expected(active, night, room, plan),
                        "{timezone} {now} active={active} room={room} {plan:?}"
                    );
                }
                let needed = needs_plan(&member, now, room);
                assert_eq!(needed, active && night && room > 0);
                if !needed {
                    let without = decide(&member, now, room, None);
                    for plan in Plan::iter() {
                        assert_eq!(decide(&member, now, room, Some(plan)), without);
                    }
                }
            }
        }
    }
}

/// Every decision is reachable.
#[test]
fn every_decision_is_reachable() {
    for decision in NightlyDecision::iter() {
        let reached = [true, false].iter().any(|&active| {
            [true, false].iter().any(|&night| {
                [0, 1].iter().any(|&room| {
                    Plan::iter()
                        .map(Some)
                        .chain([None])
                        .any(|plan| expected(active, night, room, plan) == decision)
                })
            })
        });
        assert!(reached, "{decision:?}");
    }
}

/// After each outcome a person is due their next night, again soon, at once
/// or never until seen again.
#[test]
fn each_outcome_sets_when_the_person_is_next_due() {
    let tokyo = chrono_tz::Asia::Tokyo;
    let now = utc(11, 12, 17, 30);
    let next_night = night::following(&user(), tokyo, now);
    assert!(next_night > now + TimeDelta::hours(20));
    assert!(night::in_night(tokyo, next_night));
    for outcome in NightlyOutcome::iter() {
        let next = outcome.next_run(&user(), tokyo, now);
        let expected = match outcome {
            NightlyOutcome::Started | NightlyOutcome::Skipped | NightlyOutcome::Missed => {
                Some(next_night)
            }
            NightlyOutcome::Retrying => Some(now + NIGHTLY_RETRY),
            NightlyOutcome::CutShort => Some(now),
            NightlyOutcome::Dropped => None,
        };
        assert_eq!(next, expected, "{outcome:?}");
    }
}

/// A run cut short at New York's fall-back hour is due again at once, and
/// one started then is due the next night, a day and an hour later in UTC.
#[test]
fn the_next_night_follows_the_clock_change() {
    let new_york = chrono_tz::America::New_York;
    let now = utc(10, 31, 6, 30);
    assert!(night::in_night(new_york, now));
    let next = NightlyOutcome::Started
        .next_run(&user(), new_york, now)
        .unwrap();
    assert!(night::in_night(new_york, next), "{next}");
    assert!(next - now > TimeDelta::hours(24), "{next}");
    assert_eq!(
        NightlyOutcome::CutShort.next_run(&user(), new_york, now),
        Some(now)
    );
}
