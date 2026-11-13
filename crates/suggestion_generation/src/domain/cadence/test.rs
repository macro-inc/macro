use chrono::TimeZone as _;
use strum::IntoEnumIterator as _;

use super::*;

/// Onboarding always includes routines; other triggers once a week after
/// the last good routines session, or whenever there was none.
#[test]
fn routines_come_at_onboarding_then_weekly() {
    let now = Utc.with_ymd_and_hms(2026, 11, 13, 3, 0, 0).unwrap();
    for trigger in GenerationTrigger::iter() {
        let onboarding = trigger == GenerationTrigger::Onboarding;
        assert!(routines_due(trigger, None, now), "{trigger:?}");
        assert_eq!(
            routines_due(trigger, Some(now - TimeDelta::days(6)), now),
            onboarding,
            "{trigger:?}"
        );
        assert!(
            routines_due(trigger, Some(now - ROUTINES_EVERY), now),
            "{trigger:?}"
        );
    }
}

/// Only a finished session that suggested something counts; a feed's
/// changes never do.
#[test]
fn only_a_finished_session_that_suggested_counts() {
    for ending in SessionEnding::iter() {
        let finished = ending == SessionEnding::Finished;
        assert_eq!(
            routines_ok(ending, Work::RoutinesSuggested(2)),
            finished,
            "{ending:?}"
        );
        assert!(!routines_ok(ending, Work::RoutinesSuggested(0)));
        assert!(!routines_ok(ending, Work::FeedChanges(5)));
    }
}
