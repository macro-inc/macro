use chrono::{Duration, TimeZone, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::focus::models::{FocusMessage, SentNote};

fn message(from: &str, minutes: i64, is_sent: bool, body: &str) -> FocusMessage {
    FocusMessage {
        id: Uuid::new_v4(),
        at: Utc.with_ymd_and_hms(2026, 10, 1, 9, 0, 0).unwrap() + Duration::minutes(minutes),
        is_sent,
        from_email: Some(from.to_owned()),
        from_name: None,
        to: Vec::new(),
        cc: Vec::new(),
        subject: Some("Hello".to_owned()),
        has_attachments: false,
        bulk: false,
        body: Some(body.to_owned()),
        snippet: None,
    }
}

fn thread(messages: Vec<FocusMessage>, sent_notes: Vec<SentNote>) -> FocusThread {
    FocusThread {
        thread_id: Uuid::new_v4(),
        link_id: Uuid::new_v4(),
        owner: MacroUserIdStr::try_from_email("owner@acme.com").unwrap(),
        owner_email: "owner@acme.com".to_owned(),
        is_signal: true,
        inbox_visible: true,
        classified_message_id: None,
        messages,
        sent_notes,
    }
}

fn note(recipient: &str, body: &str) -> SentNote {
    SentNote {
        recipient: recipient.to_owned(),
        body: Some(body.to_owned()),
    }
}

#[test]
fn a_stranger_is_not_a_contact() {
    let signals = signals(&thread(
        vec![message(
            "seller@leads.io",
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
        vec![message("Eva@Vendor.com", 0, false, "Your invoice")],
        vec![note("eva@vendor.com", "Yes, please send it over!")],
    ));
    assert!(signals.contact);
    assert!(!signals.replied);
}

#[test]
fn a_brushed_off_sender_is_not_a_contact() {
    let signals = signals(&thread(
        vec![
            message("seller@leads.io", 0, false, "Following up"),
            message("owner@acme.com", 5, true, "I'm not interested"),
        ],
        vec![note("seller@leads.io", "No thanks")],
    ));
    assert!(signals.replied);
    assert!(!signals.contact);
    assert!(signals.latest_from_owner);
}

#[test]
fn a_real_reply_makes_a_contact() {
    let signals = signals(&thread(
        vec![
            message("kaio@liftaris.dev", 0, false, "Application"),
            message(
                "owner@acme.com",
                5,
                true,
                "Let's chat, are you free tomorrow?",
            ),
            message("kaio@liftaris.dev", 10, false, "Yes!"),
        ],
        Vec::new(),
    ));
    assert!(signals.contact);
    assert!(signals.replied);
    assert!(!signals.latest_from_owner);
}

#[test]
fn teammates_count_unless_it_is_bulk_mail() {
    let teammate = signals(&thread(
        vec![message("jacob@acme.com", 0, false, "CRM plan")],
        Vec::new(),
    ));
    assert!(teammate.teammate);
    assert!(teammate.contact);

    let mut bulk = message("jacob@acme.com", 0, false, "Weekly digest");
    bulk.bulk = true;
    let bulk = signals(&thread(vec![bulk], Vec::new()));
    assert!(bulk.teammate);
    assert!(!bulk.contact);

    let automated = signals(&thread(
        vec![message("notifications@acme.com", 0, false, "Build failed")],
        Vec::new(),
    ));
    assert!(!automated.contact);
}

#[test]
fn freemail_owners_have_no_teammates() {
    let mut thread = thread(
        vec![message("friend@gmail.com", 0, false, "Dinner?")],
        Vec::new(),
    );
    thread.owner_email = "owner@gmail.com".to_owned();
    assert!(!signals(&thread).teammate);
}

#[test]
fn calendar_subject_comes_from_the_first_message() {
    let mut invite = message("jacob@acme.com", 0, false, "");
    invite.subject = Some("Invitation: Standup @ Mon".to_owned());
    assert!(signals(&thread(vec![invite], Vec::new())).calendar_subject);
}
