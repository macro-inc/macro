use super::*;
use crate::domain::focus::FocusQuestion;

/// Jev's recorded answers (the shipped questions, with the owner's memory as
/// context) and the owner's signals for 643 real signal threads from one
/// founder's inbox, with the verdicts of the experiment's reference
/// implementation. No email content.
const EXPERIMENT: &str = include_str!("experiment.csv");

fn flag(value: &str) -> bool {
    match value {
        "0" => false,
        "1" => true,
        other => panic!("not a 0/1 flag: {other}"),
    }
}

fn parse_row(line: &str) -> (FocusAnswers, FocusSignals, (bool, bool, bool)) {
    let cells = line.split(',').collect::<Vec<_>>();
    let answer_count = FocusQuestion::ALL.len();
    assert_eq!(cells.len(), answer_count + 8, "bad fixture row: {line}");
    let (probabilities, rest) = cells.split_at(answer_count);
    let probabilities = probabilities
        .iter()
        .map(|cell| cell.parse::<f32>().expect("probability"))
        .collect::<Vec<_>>();
    let answers =
        FocusAnswers::from_probabilities(&probabilities).expect("one answer per question");
    let signals = FocusSignals {
        contact: flag(rest[0]),
        replied: flag(rest[1]),
        teammate: flag(rest[2]),
        latest_from_owner: flag(rest[3]),
        calendar_subject: flag(rest[4]),
    };
    (
        answers,
        signals,
        (flag(rest[5]), flag(rest[6]), flag(rest[7])),
    )
}

fn answers(focus: f32) -> FocusAnswers {
    FocusAnswers {
        focus,
        outreach: 0.0,
        automated: 0.0,
        customer: 0.0,
        calendar_rsvp: 0.0,
        needs_decision: 0.0,
        needs_response: 0.0,
        needs_follow_up: 0.0,
    }
}

#[test]
fn reproduces_the_experiment_verdicts() {
    let mut rows = EXPERIMENT.lines();
    assert!(
        rows.next()
            .is_some_and(|header| header.starts_with("focus,"))
    );
    let (mut focus, mut reply, mut follow_up, mut total) = (0, 0, 0, 0);
    for (index, line) in rows.enumerate() {
        let (answers, signals, (expect_focus, expect_reply, expect_follow_up)) = parse_row(line);
        let verdict = decide(&answers, &signals);
        assert_eq!(verdict.is_focus, expect_focus, "row {index}: {line}");
        assert_eq!(verdict.needs_reply, expect_reply, "row {index}: {line}");
        assert_eq!(
            verdict.needs_follow_up, expect_follow_up,
            "row {index}: {line}"
        );
        total += 1;
        focus += usize::from(verdict.is_focus);
        reply += usize::from(verdict.needs_reply);
        follow_up += usize::from(verdict.needs_follow_up);
    }
    assert_eq!((total, focus, reply, follow_up), (643, 84, 27, 25));
}

#[test]
fn calendar_subjects() {
    for subject in [
        "Accepted: Demo @ Fri Aug 7, 2026",
        "Tentatively Accepted: Sync Team Meet",
        "Updated invitation with note: Scoping/Planning",
        "Canceled event: Standup @ Fri",
        "Invitation : spaced colon",
        "DECLINED: Prod Deploy",
    ] {
        assert!(is_calendar_subject(subject), "{subject}");
    }
    for subject in [
        "Re: Invitation: thoughts on the deck",
        "Invitations for the launch party",
        "Greg x Teo",
        "",
    ] {
        assert!(!is_calendar_subject(subject), "{subject}");
    }
}

#[test]
fn calendar_notices_stay_out_even_when_relevant() {
    let mut relevant = answers(0.9);
    let by_subject = decide(
        &relevant,
        &FocusSignals {
            calendar_subject: true,
            contact: true,
            ..FocusSignals::default()
        },
    );
    assert!(!by_subject.is_focus);
    assert_eq!(by_subject.category, FocusCategory::Calendar);

    relevant.calendar_rsvp = 0.65;
    assert!(decide(&relevant, &FocusSignals::default()).is_focus);
    relevant.calendar_rsvp = 0.7;
    assert!(!decide(&relevant, &FocusSignals::default()).is_focus);
}

#[test]
fn outreach_from_strangers_needs_a_firmer_yes() {
    let mut application = answers(0.55);
    application.outreach = 0.96;
    let stranger = decide(&application, &FocusSignals::default());
    assert!(!stranger.is_focus);
    assert_eq!(stranger.category, FocusCategory::Outreach);

    // A profile that asks for this kind of mail clears the higher bar.
    application.focus = 0.6;
    assert!(decide(&application, &FocusSignals::default()).is_focus);

    application.focus = 0.55;
    let replied = FocusSignals {
        replied: true,
        contact: true,
        ..FocusSignals::default()
    };
    assert!(decide(&application, &replied).is_focus);
}

#[test]
fn contacts_get_a_lower_bar_unless_it_is_a_pitch() {
    let contact = FocusSignals {
        contact: true,
        ..FocusSignals::default()
    };
    let borderline = answers(0.35);
    assert!(!decide(&borderline, &FocusSignals::default()).is_focus);
    let verdict = decide(&borderline, &contact);
    assert!(verdict.is_focus);
    assert_eq!(verdict.category, FocusCategory::Known);

    let mut pitch = borderline;
    pitch.outreach = 0.8;
    assert!(!decide(&pitch, &contact).is_focus);
}

#[test]
fn automated_mail_needs_someone_to_vouch_for_it() {
    let mut automated = answers(0.6);
    automated.automated = 0.9;
    let verdict = decide(&automated, &FocusSignals::default());
    assert!(!verdict.is_focus);
    assert_eq!(verdict.category, FocusCategory::Automated);

    let contact = FocusSignals {
        contact: true,
        ..FocusSignals::default()
    };
    assert!(decide(&automated, &contact).is_focus);

    let mut customer = automated;
    customer.customer = 0.7;
    let verdict = decide(&customer, &FocusSignals::default());
    assert!(verdict.is_focus);
    assert_eq!(verdict.category, FocusCategory::Customer);
}

#[test]
fn flags_need_a_confident_yes() {
    let mut maybe = answers(0.8);
    maybe.needs_response = 0.65;
    maybe.needs_follow_up = 0.65;
    let verdict = decide(&maybe, &FocusSignals::default());
    assert!(verdict.is_focus);
    assert!(!verdict.needs_reply);
    assert!(!verdict.needs_follow_up);
}

#[test]
fn reply_needed_clears_once_the_owner_answers() {
    let mut asked = answers(0.8);
    asked.needs_response = 0.9;
    assert!(decide(&asked, &FocusSignals::default()).needs_reply);
    let answered = FocusSignals {
        latest_from_owner: true,
        ..FocusSignals::default()
    };
    assert!(!decide(&asked, &answered).needs_reply);
}

#[test]
fn flags_only_apply_inside_focus() {
    let mut pitch = answers(0.1);
    pitch.outreach = 0.95;
    pitch.needs_response = 0.9;
    pitch.needs_follow_up = 0.9;
    let verdict = decide(&pitch, &FocusSignals::default());
    assert!(!verdict.is_focus);
    assert!(!verdict.needs_reply);
    assert!(!verdict.needs_follow_up);
    assert_eq!(verdict.category, FocusCategory::Outreach);
}

#[test]
fn importance_weights_reply_decision_and_relationship() {
    let mut everything = answers(1.0);
    everything.needs_response = 1.0;
    everything.needs_follow_up = 1.0;
    everything.needs_decision = 1.0;
    let contact = FocusSignals {
        contact: true,
        ..FocusSignals::default()
    };
    assert_eq!(decide(&everything, &contact).importance, 100);
    assert_eq!(
        decide(&answers(0.8), &FocusSignals::default()).importance,
        44
    );
    assert_eq!(
        decide(&answers(0.0), &FocusSignals::default()).importance,
        0
    );
}

#[test]
fn customers_outrank_other_focus_categories() {
    let mut request = answers(0.7);
    request.customer = 0.6;
    let teammate = FocusSignals {
        teammate: true,
        contact: true,
        ..FocusSignals::default()
    };
    assert_eq!(
        decide(&request, &teammate).category,
        FocusCategory::Customer
    );
    assert_eq!(
        decide(&answers(0.7), &teammate).category,
        FocusCategory::Team
    );
    assert_eq!(
        decide(&answers(0.7), &FocusSignals::default()).category,
        FocusCategory::Other
    );
}
