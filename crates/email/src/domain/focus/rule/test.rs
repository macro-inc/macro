use chrono::{DateTime, TimeZone, Utc};

use super::*;
use crate::domain::focus::FocusQuestion;

/// Jev's recorded answers (the shipped questions, with the owner's memory as
/// context) and the owner's signals for 643 real signal threads from one
/// founder's inbox, with the current rule's verdicts. No email content.
///
/// The experiment predates some signals, so `parse_row` maps its columns onto
/// them at their widest: every contact reads as recent since nothing recorded
/// dates. It also records only whether a thread's first subject looks like
/// calendar mail, with no method, sequence or event date, so it can't tell a
/// change from a new invite or an RSVP. The expected verdicts read every such
/// thread as a change to an event that isn't over, and
/// `the_experiment_bounds_what_calendar_mail_adds` counts the other extreme.
const EXPERIMENT: &str = include_str!("experiment.csv");
/// The questions the experiment recorded answers for.
const EXPERIMENT_ANSWERS: usize = 8;

fn flag(value: &str) -> bool {
    match value {
        "0" => false,
        "1" => true,
        other => panic!("not a 0/1 flag: {other}"),
    }
}

fn event_end() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 10, 17, 0, 0).unwrap()
}

fn change() -> CalendarNotice {
    CalendarNotice::Change { until: event_end() }
}

fn parse_row(
    line: &str,
    calendar_subject: CalendarNotice,
) -> (FocusAnswers, FocusSignals, (bool, bool, bool)) {
    let cells = line.split(',').collect::<Vec<_>>();
    assert_eq!(
        cells.len(),
        EXPERIMENT_ANSWERS + 8,
        "bad fixture row: {line}"
    );
    let (probabilities, rest) = cells.split_at(EXPERIMENT_ANSWERS);
    // Questions added since the experiment read 0, as they do on stored rows.
    let probabilities = probabilities
        .iter()
        .map(|cell| cell.parse::<f32>().expect("probability"))
        .chain(std::iter::repeat(0.0))
        .take(FocusQuestion::ALL.len())
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
        // Only a notice nobody wrote after counts.
        calendar: (flag(rest[4]) && !latest_from_owner).then_some(calendar_subject),
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
        grows_with_time: 0.0,
        fades_with_time: 0.0,
    }
}

fn experiment_rows() -> impl Iterator<Item = &'static str> {
    let mut rows = EXPERIMENT.lines();
    assert!(
        rows.next()
            .is_some_and(|header| header.starts_with("focus,"))
    );
    rows
}

/// In Focus for as long as nothing has run out.
fn in_focus(verdict: &FocusVerdict) -> bool {
    verdict.is_focus || verdict.calendar_hold_until.is_some()
}

#[test]
fn reproduces_the_experiment_verdicts() {
    let (mut focus, mut reply, mut follow_up, mut total) = (0, 0, 0, 0);
    let mut bands = [0; 5];
    for (index, line) in experiment_rows().enumerate() {
        let (answers, signals, (expect_focus, expect_reply, expect_follow_up)) =
            parse_row(line, change());
        let verdict = decide(&answers, &signals);
        assert_eq!(in_focus(&verdict), expect_focus, "row {index}: {line}");
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
        focus += usize::from(in_focus(&verdict));
        reply += usize::from(verdict.needs_reply);
        follow_up += usize::from(verdict.needs_follow_up);
        if in_focus(&verdict) {
            bands[usize::from(verdict.importance.min(99) / 20)] += 1;
        }
    }
    assert_eq!((total, focus, reply, follow_up), (643, 218, 48, 4));
    // Nothing in Focus reads below the 40-59 band on this inbox.
    assert_eq!(bands, [0, 0, 163, 42, 13]);
}

#[test]
fn every_experiment_thread_reads_flat_without_the_time_answers() {
    for line in experiment_rows() {
        let (answers, signals, _) = parse_row(line, change());
        assert_eq!(decide(&answers, &signals).importance_rate, 0, "{line}");
    }
}

#[test]
fn the_time_answers_change_nothing_but_the_rate() {
    for line in experiment_rows() {
        for notice in [change(), CalendarNotice::NewInvite, CalendarNotice::Rsvp] {
            let (answers, signals, _) = parse_row(line, notice);
            let without = decide(&answers, &signals);
            for (grows_with_time, fades_with_time) in [(1.0, 0.0), (0.0, 1.0), (1.0, 1.0)] {
                let with = decide(
                    &FocusAnswers {
                        grows_with_time,
                        fades_with_time,
                        ..answers
                    },
                    &signals,
                );
                assert_eq!(
                    FocusVerdict {
                        importance_rate: 0,
                        ..with
                    },
                    without,
                    "{line}"
                );
            }
        }
    }
}

#[test]
fn a_clear_lean_sets_a_signed_rate_scaled_by_how_clear_it_is() {
    let rate = |grows_with_time, fades_with_time| {
        decide(
            &FocusAnswers {
                grows_with_time,
                fades_with_time,
                ..answers(0.8)
            },
            &FocusSignals::default(),
        )
        .importance_rate
    };
    assert_eq!(rate(1.0, 0.0), 10);
    assert_eq!(rate(0.0, 1.0), -10);
    assert_eq!(rate(0.9, 0.1), 8);
    assert_eq!(rate(0.1, 0.9), -8);
    // Just past the dead band, a thread still moves, slowly.
    assert_eq!(rate(0.5, 0.05), 5);
    assert_eq!(rate(0.05, 0.5), -5);
}

#[test]
fn no_clear_lean_reads_as_flat() {
    let rate = |grows_with_time, fades_with_time| {
        decide(
            &FocusAnswers {
                grows_with_time,
                fades_with_time,
                ..answers(0.8)
            },
            &FocusSignals::default(),
        )
        .importance_rate
    };
    // Sure of neither, sure of both, and just inside the dead band either way.
    assert_eq!(rate(0.0, 0.0), 0);
    assert_eq!(rate(0.95, 0.9), 0);
    assert_eq!(rate(0.45, 0.1), 0);
    assert_eq!(rate(0.1, 0.45), 0);
}

#[test]
fn answers_stored_before_the_time_questions_decode_as_flat() {
    let stored = r#"{
        "focus": 0.8, "outreach": 0.0, "automated": 0.0, "customer": 0.0,
        "calendar_rsvp": 0.0, "needs_decision": 0.0, "needs_response": 0.0,
        "needs_follow_up": 0.0
    }"#;
    let answers = serde_json::from_str::<FocusAnswers>(stored).unwrap();
    assert_eq!(answers.grows_with_time, 0.0);
    assert_eq!(answers.fades_with_time, 0.0);
    assert_eq!(
        decide(&answers, &FocusSignals::default()).importance_rate,
        0
    );
}

#[test]
fn the_experiment_bounds_what_calendar_mail_adds() {
    let count = |calendar_subject| {
        let (mut focus, mut reply, mut follow_up) = (0, 0, 0);
        for line in experiment_rows() {
            let (answers, signals, _) = parse_row(line, calendar_subject);
            let verdict = decide(&answers, &signals);
            focus += usize::from(in_focus(&verdict));
            reply += usize::from(verdict.needs_reply);
            follow_up += usize::from(verdict.needs_follow_up);
        }
        (focus, reply, follow_up)
    };
    // Every thread whose first subject looks like calendar mail is a change to
    // an event that isn't over, or none is.
    assert_eq!(count(change()), (218, 48, 4));
    assert_eq!(count(CalendarNotice::NewInvite), (96, 44, 4));
}

#[test]
fn a_calendar_change_is_held_whatever_else_it_reads_as() {
    // A reschedule reads as automated, low relevance and from a stranger.
    let mut reschedule = answers(0.05);
    reschedule.automated = 0.95;
    reschedule.outreach = 0.8;
    let verdict = decide(
        &reschedule,
        &FocusSignals {
            calendar: Some(change()),
            ..FocusSignals::default()
        },
    );
    assert_eq!(verdict.calendar_hold_until, Some(event_end()));
    assert_eq!(verdict.importance, 50);
    // Once the hold ends nothing else keeps it in, and it reads as what it is.
    assert!(!verdict.is_focus && !verdict.pinned);
    assert_eq!(verdict.category, FocusCategory::Outreach);
}

#[test]
fn a_calendar_change_on_mail_that_earned_focus_stays_in_after_the_hold() {
    let signals = FocusSignals {
        calendar: Some(change()),
        contact: true,
        ..FocusSignals::default()
    };
    let verdict = decide(&answers(0.8), &signals);
    assert!(verdict.is_focus && verdict.calendar_hold_until.is_some());
    assert_eq!(verdict.category, FocusCategory::Known);
}

#[test]
fn a_held_calendar_change_can_still_need_a_reply() {
    let mut asked = answers(0.05);
    asked.automated = 0.95;
    asked.needs_response = 0.9;
    let verdict = decide(
        &asked,
        &FocusSignals {
            calendar: Some(change()),
            ..FocusSignals::default()
        },
    );
    assert!(!verdict.is_focus && verdict.needs_reply && !verdict.needs_follow_up);
    assert_eq!(verdict.importance, 70);
}

#[test]
fn new_invites_and_rsvps_stay_out_even_when_relevant() {
    let mut relevant = answers(0.9);
    relevant.needs_response = 0.9;
    for notice in [CalendarNotice::NewInvite, CalendarNotice::Rsvp] {
        let verdict = decide(
            &relevant,
            &FocusSignals {
                calendar: Some(notice),
                contact: true,
                recent_contact: true,
                ..FocusSignals::default()
            },
        );
        assert!(!verdict.is_focus && !verdict.pinned, "{notice:?}");
        assert_eq!(verdict.calendar_hold_until, None, "{notice:?}");
        assert!(!verdict.needs_reply, "{notice:?}");
        assert_eq!(verdict.category, FocusCategory::Calendar, "{notice:?}");
    }
}

#[test]
fn jevs_calendar_answer_neither_holds_nor_vetoes() {
    // Jev alone is sure this is calendar mail: it takes the normal rule either way.
    let mut unwanted = answers(0.05);
    unwanted.calendar_rsvp = 0.95;
    let verdict = decide(&unwanted, &FocusSignals::default());
    assert!(!verdict.is_focus);
    assert_eq!(verdict.calendar_hold_until, None);
    assert_eq!(verdict.category, FocusCategory::LowRelevance);

    let mut wanted = answers(0.8);
    wanted.calendar_rsvp = 0.95;
    let contact = FocusSignals {
        contact: true,
        ..FocusSignals::default()
    };
    let verdict = decide(&wanted, &contact);
    assert!(verdict.is_focus);
    assert_eq!(verdict.category, FocusCategory::Known);
    let verdict = decide(&wanted, &FocusSignals::default());
    assert!(verdict.is_focus);
    assert_eq!(verdict.category, FocusCategory::Other);
}

#[test]
fn calendar_only_ever_describes_a_change_or_a_thread_left_out() {
    for line in experiment_rows() {
        for notice in [change(), CalendarNotice::NewInvite, CalendarNotice::Rsvp] {
            let (answers, signals, _) = parse_row(line, notice);
            let verdict = decide(&answers, &signals);
            if verdict.category == FocusCategory::Calendar {
                assert!(!verdict.is_focus && !verdict.awaiting_reply, "{line}");
                assert_eq!(verdict.calendar_hold_until, None, "{line}");
            }
        }
    }
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
