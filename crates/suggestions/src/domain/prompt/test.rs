use chrono::TimeZone;

use super::*;

/// The brief tells the session the person's weekday and local time, so
/// "today" and "tomorrow" need no arithmetic, and leaves no placeholder.
#[test]
fn the_brief_states_the_persons_local_day_and_fills_every_placeholder() {
    let now = Utc.with_ymd_and_hms(2026, 11, 10, 18, 30, 0).unwrap();
    let tokyo = brief(GenerationTrigger::Nightly, "Asia/Tokyo", now, "", "a-model");
    assert!(
        tokyo.contains(
            "Now is Wednesday 2026-11-11 03:30 for the user (Asia/Tokyo), 2026-11-10T18:30:00Z."
        ),
        "{}",
        tokyo.lines().last().unwrap_or_default()
    );
    for placeholder in [
        "{occasion}",
        "{docs}",
        "{open_limit}",
        "{new_per_generation}",
        "{checker_model}",
    ] {
        assert!(
            !tokyo.contains(placeholder),
            "{placeholder} left in the brief"
        );
    }
    assert!(tokyo.contains("model: 'a-model'"));
    let unknown = brief(
        GenerationTrigger::Onboarding,
        "Mars/Olympus",
        now,
        "",
        "a-model",
    );
    assert!(unknown.contains("Now is 2026-11-10T18:30:00Z; the user's time zone is Mars/Olympus."));
}

/// Each trigger has its own occasion; only onboarding asks for speed.
#[test]
fn every_trigger_has_its_own_occasion() {
    use strum::IntoEnumIterator as _;
    let now = Utc.with_ymd_and_hms(2026, 11, 10, 18, 30, 0).unwrap();
    let briefs: Vec<(GenerationTrigger, String)> = GenerationTrigger::iter()
        .map(|trigger| (trigger, brief(trigger, "Europe/Paris", now, "", "a-model")))
        .collect();
    for (index, (trigger, text)) in briefs.iter().enumerate() {
        for (other, other_text) in &briefs[index + 1..] {
            assert_ne!(text, other_text, "{trigger:?} and {other:?} brief alike");
        }
        assert_eq!(
            text.contains("Be quick"),
            *trigger == GenerationTrigger::Onboarding,
            "{trigger:?}"
        );
    }
    assert!(
        brief(
            GenerationTrigger::Manual,
            "Europe/Paris",
            now,
            "",
            "a-model"
        )
        .contains("asked for fresh suggestions")
    );
}
