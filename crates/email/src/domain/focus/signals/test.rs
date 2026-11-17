use chrono::{DateTime, Duration, TimeZone, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::focus::models::{CalendarNotice, CalendarPart, FocusMessage, SentNote};

fn start() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 1, 9, 0, 0).unwrap()
}

fn message(from: &str, minutes: i64, is_sent: bool, body: &str) -> FocusMessage {
    FocusMessage {
        id: Uuid::new_v4(),
        at: start() + Duration::minutes(minutes),
        is_sent,
        from_email: Some(from.to_owned()),
        from_name: None,
        to: Vec::new(),
        cc: Vec::new(),
        subject: Some("Hello".to_owned()),
        has_attachments: false,
        bulk: false,
        calendar_part: None,
        body: Some(body.to_owned()),
        snippet: None,
        date_header: None,
    }
}

fn reply_to(to: &str, minutes: i64, body: &str) -> FocusMessage {
    FocusMessage {
        to: vec![to.to_owned()],
        ..message("owner@acme.example", minutes, true, body)
    }
}

fn thread(messages: Vec<FocusMessage>, sent_notes: Vec<SentNote>) -> FocusThread {
    FocusThread {
        thread_id: Uuid::new_v4(),
        link_id: Uuid::new_v4(),
        owner: MacroUserIdStr::try_from_email("owner@acme.example").unwrap(),
        owner_email: "owner@acme.example".to_owned(),
        is_signal: true,
        inbox_visible: true,
        classified: None,
        messages,
        sent_notes,
    }
}

fn note(recipient: &str, days_ago: i64, body: &str) -> SentNote {
    SentNote {
        recipient: recipient.to_owned(),
        at: start() - Duration::days(days_ago),
        body: Some(body.to_owned()),
    }
}

fn with_subject(mut message: FocusMessage, subject: &str) -> FocusMessage {
    message.subject = Some(subject.to_owned());
    message
}

fn with_part(mut message: FocusMessage, part: CalendarPart) -> FocusMessage {
    message.calendar_part = Some(part);
    message
}

fn saved_change(message: FocusMessage) -> FocusMessage {
    let until = message.at + Duration::days(2);
    with_part(message, CalendarPart::Change { until })
}

fn calendar(messages: Vec<FocusMessage>) -> Option<CalendarNotice> {
    signals(&thread(messages, Vec::new())).calendar
}

#[test]
fn a_stranger_is_not_a_contact() {
    let signals = signals(&thread(
        vec![message(
            "seller@leads.example",
            0,
            false,
            "Quick question for you",
        )],
        Vec::new(),
    ));
    assert_eq!(signals, FocusSignals::default());
}

#[test]
fn someone_the_owner_wrote_to_is_a_contact() {
    let signals = signals(&thread(
        vec![message("Eva@Vendor.example", 0, false, "Your invoice")],
        vec![note("eva@vendor.example", 1, "Yes, please send it over!")],
    ));
    assert!(signals.contact);
    assert!(!signals.replied);
}

#[test]
fn a_recent_contact_is_someone_the_owner_wrote_to_within_the_window() {
    let incoming = message("eva@vendor.example", 0, false, "Your invoice");
    let inside = signals(&thread(
        vec![incoming.clone()],
        vec![note("eva@vendor.example", 89, "Yes, please send it over!")],
    ));
    assert!(inside.contact && inside.recent_contact);

    // Older mail still makes a contact, but not a recent one.
    let outside = signals(&thread(
        vec![incoming.clone()],
        vec![note("eva@vendor.example", 91, "Yes, please send it over!")],
    ));
    assert!(outside.contact && !outside.recent_contact);

    let brush_off = signals(&thread(
        vec![incoming],
        vec![note("eva@vendor.example", 1, "No thanks")],
    ));
    assert!(brush_off.brushed_off && !brush_off.recent_contact);
}

#[test]
fn bulk_and_automated_senders_are_never_recent_contacts() {
    let mut newsletter = message("eva@vendor.example", 0, false, "This week");
    newsletter.bulk = true;
    let newsletter = signals(&thread(
        vec![newsletter],
        vec![note("eva@vendor.example", 1, "Love this, can we talk?")],
    ));
    assert!(newsletter.contact && !newsletter.recent_contact);

    let automated = signals(&thread(
        vec![message("alerts@vendor.example", 0, false, "Build failed")],
        vec![note("alerts@vendor.example", 1, "Who owns this alert?")],
    ));
    assert!(automated.contact && !automated.recent_contact);
}

#[test]
fn a_real_reply_in_the_thread_is_a_recent_contact() {
    let signals = signals(&thread(
        vec![
            message("kaio@applicant.example", 0, false, "Application"),
            reply_to("kaio@applicant.example", 5, "Let's chat tomorrow"),
            message("kaio@applicant.example", 10, false, "Yes!"),
        ],
        Vec::new(),
    ));
    assert!(signals.recent_contact);
}

#[test]
fn a_brushed_off_sender_is_not_a_contact() {
    let signals = signals(&thread(
        vec![
            message("seller@leads.example", 0, false, "Following up"),
            reply_to("seller@leads.example", 5, "I'm not interested"),
        ],
        vec![note("seller@leads.example", 1, "No thanks")],
    ));
    assert!(signals.replied);
    assert!(signals.brushed_off);
    assert!(!signals.contact);
    assert!(signals.latest_from_owner);
    assert!(!signals.awaiting_reply);
}

#[test]
fn a_real_reply_makes_a_contact() {
    let signals = signals(&thread(
        vec![
            message("kaio@applicant.example", 0, false, "Application"),
            reply_to(
                "kaio@applicant.example",
                5,
                "Let's chat, are you free tomorrow?",
            ),
            message("kaio@applicant.example", 10, false, "Yes!"),
        ],
        Vec::new(),
    ));
    assert!(signals.contact);
    assert!(signals.replied);
    assert!(!signals.latest_from_owner);
    assert!(!signals.awaiting_reply);
}

#[test]
fn the_owner_answering_last_awaits_a_reply() {
    let incoming = message("kaio@applicant.example", 0, false, "Application");
    let waiting = signals(&thread(
        vec![
            incoming.clone(),
            reply_to("Kaio@Applicant.example", 5, "Are you free tomorrow?"),
        ],
        Vec::new(),
    ));
    assert!(waiting.latest_from_owner && waiting.awaiting_reply);

    // A person can answer from a shared address.
    let shared_address = signals(&thread(
        vec![
            message("support@vendor.example", 0, false, "Ticket opened"),
            reply_to("support@vendor.example", 5, "Any update on this?"),
        ],
        Vec::new(),
    ));
    assert!(shared_address.awaiting_reply);

    for (reason, reply) in [
        (
            "an acknowledgement",
            reply_to("kaio@applicant.example", 5, "Thanks!"),
        ),
        (
            "a brush-off",
            reply_to("kaio@applicant.example", 5, "No thanks"),
        ),
        (
            "an address nobody reads",
            reply_to("no-reply@applicant.example", 5, "Hello?"),
        ),
        (
            "no one else addressed",
            reply_to("owner@acme.example", 5, "Note to self"),
        ),
    ] {
        let signals = signals(&thread(vec![incoming.clone(), reply], Vec::new()));
        assert!(signals.latest_from_owner, "{reason}");
        assert!(!signals.awaiting_reply, "{reason}");
    }
}

#[test]
fn only_mail_sent_by_the_owner_awaits_nothing() {
    let signals = signals(&thread(
        vec![reply_to(
            "kaio@applicant.example",
            0,
            "Are you free tomorrow?",
        )],
        Vec::new(),
    ));
    assert!(signals.latest_from_owner);
    assert!(!signals.awaiting_reply);
    assert!(!signals.is_key_mail(start()));
}

#[test]
fn a_support_thread_opened_by_a_tool_still_awaits_a_reply() {
    let mut opened_by_a_tool = message("help@vendor.example", 0, false, "Ticket opened");
    opened_by_a_tool.bulk = true;
    let signals = signals(&thread(
        vec![
            opened_by_a_tool,
            message("ana@vendor.example", 5, false, "Looking into it"),
            reply_to("ana@vendor.example", 10, "Any update on this?"),
        ],
        Vec::new(),
    ));
    assert!(signals.latest_from_owner && signals.awaiting_reply);
}

#[test]
fn the_owners_own_calendar_notice_awaits_nothing() {
    let signals = signals(&thread(
        vec![
            message("kaio@applicant.example", 0, false, "Application"),
            saved_change(reply_to(
                "kaio@applicant.example",
                5,
                "Joining details attached",
            )),
        ],
        Vec::new(),
    ));
    assert!(signals.latest_from_owner && !signals.awaiting_reply);
    // Nor does it make the thread a notice for the owner to read.
    assert_eq!(signals.calendar, None);
}

#[test]
fn teammates_count_unless_it_is_bulk_mail() {
    let teammate = signals(&thread(
        vec![message("jacob@acme.example", 0, false, "CRM plan")],
        Vec::new(),
    ));
    assert!(teammate.teammate);
    assert!(teammate.contact);
    assert!(!teammate.recent_contact);

    let mut bulk = message("jacob@acme.example", 0, false, "Weekly digest");
    bulk.bulk = true;
    let bulk = signals(&thread(vec![bulk], Vec::new()));
    assert!(bulk.teammate);
    assert!(!bulk.contact);

    let automated = signals(&thread(
        vec![message(
            "notifications@acme.example",
            0,
            false,
            "Build failed",
        )],
        Vec::new(),
    ));
    assert!(!automated.contact);
}

#[test]
fn freemail_owners_have_no_teammates() {
    let freemail = FREEMAIL_DOMAINS[0];
    let mut thread = thread(
        vec![message(&format!("friend@{freemail}"), 0, false, "Dinner?")],
        Vec::new(),
    );
    thread.owner_email = format!("owner@{freemail}");
    assert!(!signals(&thread).teammate);
}

#[test]
fn a_notice_counts_only_as_the_threads_latest_message() {
    let first = message("jacob@acme.example", 0, false, "Can we meet?");
    let reschedule = with_subject(
        message("jacob@acme.example", 5, false, ""),
        "Rescheduled: Demo @ Thu",
    );
    let later = message("jacob@acme.example", 10, false, "Does Friday work instead?");
    assert!(matches!(
        calendar(vec![first.clone(), reschedule.clone()]),
        Some(CalendarNotice::Change { .. })
    ));
    // Someone wrote after it: a conversation.
    assert_eq!(calendar(vec![first, reschedule.clone(), later]), None);

    // The owner answered it: they have seen it, and may be waiting on an answer.
    let answered = signals(&thread(
        vec![
            reschedule.clone(),
            reply_to("jacob@acme.example", 10, "Does Friday work instead?"),
        ],
        Vec::new(),
    ));
    assert_eq!(answered.calendar, None);
    assert!(answered.awaiting_reply);

    // The owner's own RSVP settles it the same way, and awaits nothing.
    let rsvp = with_part(reply_to("jacob@acme.example", 10, ""), CalendarPart::Rsvp);
    let accepted = signals(&thread(vec![reschedule, rsvp], Vec::new()));
    assert_eq!(accepted.calendar, None);
    assert!(!accepted.awaiting_reply);
}

#[test]
fn a_new_invite_or_rsvp_behind_a_later_message_is_a_conversation() {
    let invite = with_subject(
        message("jacob@acme.example", 0, false, ""),
        "Invitation: Demo @ Thu",
    );
    let rsvp = with_subject(
        message("jacob@acme.example", 0, false, ""),
        "Accepted: Demo @ Thu",
    );
    let person = with_subject(
        message("jacob@acme.example", 5, false, "Can we move it?"),
        "Re: Invitation: Demo @ Thu",
    );
    assert_eq!(
        calendar(vec![invite.clone()]),
        Some(CalendarNotice::NewInvite)
    );
    assert_eq!(calendar(vec![invite.clone(), person.clone()]), None);
    assert_eq!(calendar(vec![rsvp.clone(), person]), None);

    // The latest message settles it, whatever came before.
    assert_eq!(calendar(vec![invite, rsvp]), Some(CalendarNotice::Rsvp));
}

#[test]
fn key_mail_is_changes_to_events_ahead_recent_contacts_and_waiting_threads() {
    let now = start();
    let change_until = |until| FocusSignals {
        calendar: Some(CalendarNotice::Change { until }),
        ..FocusSignals::default()
    };
    let recent = FocusSignals {
        recent_contact: true,
        ..FocusSignals::default()
    };
    let waiting = FocusSignals {
        awaiting_reply: true,
        ..FocusSignals::default()
    };
    let notice = |notice| FocusSignals {
        calendar: Some(notice),
        ..FocusSignals::default()
    };
    let contact = FocusSignals {
        contact: true,
        ..FocusSignals::default()
    };
    assert!(change_until(now + Duration::minutes(1)).is_key_mail(now));
    assert!(recent.is_key_mail(now) && waiting.is_key_mail(now));
    assert!(!change_until(now).is_key_mail(now));
    assert!(!change_until(now - Duration::days(1)).is_key_mail(now));
    assert!(!notice(CalendarNotice::NewInvite).is_key_mail(now));
    assert!(!notice(CalendarNotice::Rsvp).is_key_mail(now));
    assert!(!contact.is_key_mail(now));
}
