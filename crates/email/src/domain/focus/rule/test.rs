use super::*;
use crate::domain::focus::FocusQuestion;

/// Jev's recorded answers (the shipped questions, with the owner's memory as
/// context) and the owner's signals for 643 real signal threads from one
/// founder's inbox, with the current rule's verdicts. No email content.
///
/// The experiment predates some signals, so `parse_row` maps its columns onto
/// them at their widest: a calendar subject reads as a scheduling notice since
/// nothing recorded which were RSVPs, and every contact reads as recent since
/// nothing recorded dates. The counts below are therefore upper bounds.
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
    let contact = flag(rest[0]);
    let replied = flag(rest[1]);
    let latest_from_owner = flag(rest[3]);
    let signals = FocusSignals {
        contact,
        recent_contact: contact,
        // A reply that didn't make the sender a contact only turned them away.
        brushed_off: replied && !contact,
        replied,
        teammate: flag(rest[2]),
        latest_from_owner,
        calendar: flag(rest[4]).then_some(CalendarNotice::Scheduling),
        awaiting_reply: latest_from_owner && contact,
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
    let mut bands = [0; 5];
    for (index, line) in rows.enumerate() {
        let (answers, signals, (expect_focus, expect_reply, expect_follow_up)) = parse_row(line);
        let verdict = decide(&answers, &signals);
        assert_eq!(verdict.is_focus, expect_focus, "row {index}: {line}");
        assert_eq!(verdict.needs_reply, expect_reply, "row {index}: {line}");
        assert_eq!(
            verdict.needs_follow_up, expect_follow_up,
            "row {index}: {line}"
        );
        assert!(
            !(verdict.needs_reply && verdict.needs_follow_up),
            "row {index}: {line}"
        );
        total += 1;
        focus += usize::from(verdict.is_focus);
        reply += usize::from(verdict.needs_reply);
        follow_up += usize::from(verdict.needs_follow_up);
        if verdict.is_focus {
            bands[usize::from(verdict.importance.min(99) / 20)] += 1;
        }
    }
    assert_eq!((total, focus, reply, follow_up), (643, 221, 49, 4));
    // Nothing in Focus reads below the 40-59 band on this inbox.
    assert_eq!(bands, [0, 0, 165, 43, 13]);
}

#[test]
fn calendar_subjects_tell_scheduling_from_rsvps() {
    for subject in [
        "Invitation: Standup @ Mon",
        "Updated invitation with note: Scoping/Planning",
        "Canceled event: Standup @ Fri",
        "CANCELLED: Prod Deploy",
        "Invitation : spaced colon",
        "Rescheduled: Demo @ Thu",
        "Proposed new time: Demo @ Thu",
    ] {
        assert_eq!(
            calendar_notice_in_subject(subject),
            Some(CalendarNotice::Scheduling),
            "{subject}"
        );
    }
    for subject in [
        "Accepted: Demo @ Fri Aug 7, 2026",
        "Tentatively Accepted: Sync Team Meet",
        "Tentative: Standup",
        "DECLINED: Prod Deploy",
    ] {
        assert_eq!(
            calendar_notice_in_subject(subject),
            Some(CalendarNotice::Rsvp),
            "{subject}"
        );
    }
    for subject in [
        "Re: Invitation: thoughts on the deck",
        "Invitations for the launch party",
        "Can we reschedule Tuesday?",
        "Greg x Teo",
        "",
    ] {
        assert_eq!(calendar_notice_in_subject(subject), None, "{subject}");
    }
}

#[test]
fn scheduling_notices_are_in_whatever_else_they_read_as() {
    // A reschedule reads as automated, low relevance and from a stranger.
    let mut reschedule = answers(0.05);
    reschedule.automated = 0.95;
    reschedule.outreach = 0.8;
    let by_signal = decide(
        &reschedule,
        &FocusSignals {
            calendar: Some(CalendarNotice::Scheduling),
            ..FocusSignals::default()
        },
    );
    assert!(by_signal.is_focus && by_signal.pinned);
    assert_eq!(by_signal.category, FocusCategory::Calendar);
    assert_eq!(by_signal.importance, 50);

    // Jev alone calls it one only when it is sure.
    reschedule.calendar_rsvp = 0.7;
    let by_answer = decide(&reschedule, &FocusSignals::default());
    assert!(by_answer.is_focus);
    assert_eq!(by_answer.category, FocusCategory::Calendar);
    reschedule.calendar_rsvp = 0.65;
    assert!(!decide(&reschedule, &FocusSignals::default()).is_focus);
}

#[test]
fn rsvp_notices_stay_out_even_when_relevant() {
    let mut relevant = answers(0.9);
    relevant.calendar_rsvp = 0.95;
    relevant.needs_response = 0.9;
    let verdict = decide(
        &relevant,
        &FocusSignals {
            calendar: Some(CalendarNotice::Rsvp),
            contact: true,
            recent_contact: true,
            ..FocusSignals::default()
        },
    );
    assert!(!verdict.is_focus && !verdict.pinned);
    assert!(!verdict.needs_reply);
    assert_eq!(verdict.category, FocusCategory::Calendar);
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
    assert!(!verdict.pinned);
    assert_eq!(verdict.category, FocusCategory::Known);

    let mut pitch = borderline;
    pitch.outreach = 0.8;
    assert!(!decide(&pitch, &contact).is_focus);

    // Long-ago correspondence alone doesn't hold a thread in Focus.
    assert!(!decide(&answers(0.05), &contact).is_focus);
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
fn a_reply_the_owner_owes_stays_in_on_a_low_score() {
    let mut asked = answers(0.1);
    asked.needs_response = 0.9;
    let verdict = decide(&asked, &FocusSignals::default());
    assert!(verdict.is_focus && verdict.pinned && verdict.needs_reply);
    assert_eq!(verdict.category, FocusCategory::Other);
    assert_eq!(verdict.importance, 70);

    let mut pitch = asked;
    pitch.outreach = 0.8;
    assert!(!decide(&pitch, &FocusSignals::default()).is_focus);

    let mut newsletter = asked;
    newsletter.automated = 0.8;
    assert!(!decide(&newsletter, &FocusSignals::default()).is_focus);

    let turned_away = FocusSignals {
        brushed_off: true,
        ..FocusSignals::default()
    };
    assert!(!decide(&asked, &turned_away).is_focus);
}

#[test]
fn mail_from_recent_contacts_stays_in_on_a_low_score() {
    let recent = FocusSignals {
        contact: true,
        recent_contact: true,
        ..FocusSignals::default()
    };
    let verdict = decide(&answers(0.05), &recent);
    assert!(verdict.is_focus && verdict.pinned);
    assert_eq!(verdict.category, FocusCategory::Known);
    assert_eq!(verdict.importance, 50);

    let mut pitch = answers(0.05);
    pitch.outreach = 0.8;
    assert!(!decide(&pitch, &recent).is_focus);

    let mut automated = answers(0.05);
    automated.automated = 0.8;
    assert!(!decide(&automated, &recent).is_focus);
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
fn who_wrote_last_settles_reply_or_follow_up() {
    let mut flagged = answers(0.8);
    flagged.needs_response = 0.9;
    flagged.needs_follow_up = 0.9;

    let theirs = decide(&flagged, &FocusSignals::default());
    assert!(theirs.needs_reply && !theirs.needs_follow_up);

    let owners = FocusSignals {
        latest_from_owner: true,
        ..FocusSignals::default()
    };
    let ours = decide(&flagged, &owners);
    assert!(!ours.needs_reply && ours.needs_follow_up);

    // An open loop on someone else's message is still the owner's to answer.
    let mut open_loop = answers(0.8);
    open_loop.needs_follow_up = 0.9;
    let verdict = decide(&open_loop, &FocusSignals::default());
    assert!(verdict.needs_reply && !verdict.needs_follow_up);
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
fn a_thread_awaiting_a_reply_waits_for_the_read_to_join_focus() {
    let waiting = FocusSignals {
        latest_from_owner: true,
        awaiting_reply: true,
        ..FocusSignals::default()
    };
    let verdict = decide(&answers(0.05), &waiting);
    // Age isn't known here: the list decides, and finds it already labeled.
    assert!(!verdict.is_focus);
    assert!(verdict.awaiting_reply);
    assert!(!verdict.needs_follow_up);
    assert_eq!(verdict.importance, 55);
    assert_eq!(verdict.category, FocusCategory::Other);

    let mut customer = answers(0.05);
    customer.customer = 0.8;
    assert_eq!(
        decide(&customer, &waiting).category,
        FocusCategory::Customer
    );
}

#[test]
fn importance_reflects_why_a_thread_is_in() {
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

    // A customer Jev rates low is in Focus, so it doesn't read as noise.
    let mut customer = answers(0.1);
    customer.customer = 0.9;
    assert_eq!(decide(&customer, &FocusSignals::default()).importance, 50);
    // Neither does a thread that only just cleared the contact bar.
    assert_eq!(decide(&answers(0.3), &contact).importance, 30);
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
