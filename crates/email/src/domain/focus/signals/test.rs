use chrono::{DateTime, Duration, TimeZone, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::focus::models::{CalendarPart, FocusMessage, SentNote};

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
    assert!(!signals.is_key_mail());
}

#[test]
fn replying_to_list_mail_awaits_nothing() {
    let mut list_mail = message("eva@vendor.example", 0, false, "This week");
    list_mail.bulk = true;
    let signals = signals(&thread(
        vec![
            list_mail,
            reply_to("eva@vendor.example", 5, "Can you add me?"),
        ],
        Vec::new(),
    ));
    assert!(signals.latest_from_owner && !signals.awaiting_reply);
}

#[test]
fn the_owners_own_calendar_notice_awaits_nothing() {
    let signals = signals(&thread(
        vec![
            message("kaio@applicant.example", 0, false, "Application"),
            with_part(
                reply_to("kaio@applicant.example", 5, "Joining details attached"),
                CalendarPart::Scheduling,
            ),
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
fn a_reschedule_later_in_a_thread_counts() {
    let first = message("jacob@acme.example", 0, false, "Can we meet?");
    let reschedule = with_subject(
        message("jacob@acme.example", 5, false, ""),
        "Rescheduled: Demo @ Thu",
    );
    let update = with_subject(
        message("jacob@acme.example", 5, false, ""),
        "Updated invitation: Demo @ Thu",
    );
    assert_eq!(
        calendar(vec![first.clone(), reschedule]),
        Some(CalendarNotice::Scheduling)
    );
    assert_eq!(
        calendar(vec![first, update]),
        Some(CalendarNotice::Scheduling)
    );
}

#[test]
fn a_saved_calendar_part_decides_whatever_the_subject_says() {
    let plain = message("jacob@acme.example", 0, false, "");
    assert_eq!(
        calendar(vec![with_part(plain.clone(), CalendarPart::Scheduling)]),
        Some(CalendarNotice::Scheduling)
    );
    // An RSVP in another language has no subject prefix to match.
    assert_eq!(
        calendar(vec![with_part(
            with_subject(plain.clone(), "Aceptada: Demo"),
            CalendarPart::Rsvp
        )]),
        Some(CalendarNotice::Rsvp)
    );
    // A calendar file nothing could read reads as its subject, or as scheduling.
    assert_eq!(
        calendar(vec![with_part(
            with_subject(plain.clone(), "Accepted: Demo"),
            CalendarPart::Unparsed
        )]),
        Some(CalendarNotice::Rsvp)
    );
    assert_eq!(
        calendar(vec![with_part(plain, CalendarPart::Unparsed)]),
        Some(CalendarNotice::Scheduling)
    );
}

#[test]
fn a_person_replying_to_a_notice_does_not_end_it_but_does_end_an_rsvp() {
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
        calendar(vec![invite.clone(), person.clone()]),
        Some(CalendarNotice::Scheduling)
    );
    assert_eq!(calendar(vec![rsvp.clone(), person]), None);

    // The newest thing to read being an RSVP settles it, invite or not.
    assert_eq!(calendar(vec![invite, rsvp]), Some(CalendarNotice::Rsvp));
}

#[test]
fn key_mail_is_scheduling_recent_contacts_and_waiting_threads() {
    let scheduling = FocusSignals {
        calendar: Some(CalendarNotice::Scheduling),
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
    let rsvp = FocusSignals {
        calendar: Some(CalendarNotice::Rsvp),
        ..FocusSignals::default()
    };
    let contact = FocusSignals {
        contact: true,
        ..FocusSignals::default()
    };
    assert!(scheduling.is_key_mail() && recent.is_key_mail() && waiting.is_key_mail());
    assert!(!rsvp.is_key_mail() && !contact.is_key_mail());
}
