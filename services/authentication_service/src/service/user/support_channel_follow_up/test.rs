use super::*;

fn at(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(1_800_000_000 + seconds, 0).unwrap()
}

fn finished(inbox_domain: Option<&str>, team: Option<&str>, tools: &[&str]) -> Setup {
    Setup {
        finished_onboarding: true,
        inbox_domain: inbox_domain.map(str::to_owned),
        team: team.map(str::to_owned),
        tools: tools.iter().map(|tool| (*tool).to_owned()).collect(),
    }
}

#[test]
fn sends_shortly_after_onboarding_finishes_and_otherwise_at_five_minutes() {
    let welcomed = at(0);

    assert_eq!(due(welcomed, None, at(299)), None);
    assert_eq!(due(welcomed, None, at(300)), Some(Trigger::Fallback));

    let finished_onboarding = Some(at(90));
    assert_eq!(due(welcomed, finished_onboarding, at(119)), None);
    assert_eq!(
        due(welcomed, finished_onboarding, at(120)),
        Some(Trigger::OnboardingFinished)
    );

    // Finishing onboarding before the welcome posted doesn't hold it back.
    assert_eq!(
        due(at(60), Some(at(10)), at(60)),
        Some(Trigger::OnboardingFinished)
    );
}

#[test]
fn asks_about_the_strongest_onboarding_signal() {
    assert_eq!(segment(&Setup::default()), Segment::Unfinished);
    assert_eq!(
        segment(&finished(None, Some("Acme"), &["Linear"])),
        Segment::NoInbox
    );
    assert_eq!(
        segment(&finished(Some("acme.com"), Some("Acme"), &["Linear"])),
        Segment::Team("Acme")
    );
    assert_eq!(
        segment(&finished(Some("acme.com"), None, &["Linear", "GitHub"])),
        Segment::Tools(&["Linear".to_owned(), "GitHub".to_owned()])
    );
    assert_eq!(
        segment(&finished(Some("acme.com"), None, &[])),
        Segment::WorkInbox("acme.com")
    );
    assert_eq!(
        segment(&finished(Some("gmail.com"), None, &[])),
        Segment::PersonalInbox
    );
}

#[test]
fn every_message_asks_one_short_question() {
    let tools = ["Google Drive".to_owned(), "Linear".to_owned()];
    let segments = [
        Segment::Unfinished,
        Segment::NoInbox,
        Segment::Team("Acme Design Studio"),
        Segment::Tools(&tools[..1]),
        Segment::Tools(&tools),
        Segment::WorkInbox("acme.com"),
        Segment::PersonalInbox,
    ];
    for segment in &segments {
        let text = message("@Sam", segment);
        let words = text.split_whitespace().count();
        assert!((15..=35).contains(&words), "{words} words: {text}");
        assert_eq!(text.matches('?').count(), 1, "{text}");
        assert!(!text.contains([':', ';']), "{text}");
    }
}

#[test]
fn leaves_markup_and_long_names_out_of_the_message() {
    assert_eq!(plain_name("  Acme & Co.  "), Some("Acme & Co."));
    assert_eq!(plain_name("**Acme**"), None);
    assert_eq!(plain_name("<m-user-mention>x</m-user-mention>"), None);
    assert_eq!(plain_name("[Acme](https://example.com)"), None);
    assert_eq!(plain_name(&"a".repeat(41)), None);
    assert_eq!(plain_name("   "), None);
}
