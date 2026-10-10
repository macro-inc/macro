use chrono::{TimeZone, Utc};
use uuid::Uuid;

use super::*;
use crate::domain::focus::models::FocusThread;

fn message(body: &str, is_sent: bool) -> FocusMessage {
    FocusMessage {
        id: Uuid::new_v4(),
        at: Utc.with_ymd_and_hms(2026, 10, 6, 21, 31, 47).unwrap(),
        is_sent,
        from_email: Some("ava@example.com".to_owned()),
        from_name: Some("Ava".to_owned()),
        to: vec!["owner@acme.com".to_owned()],
        cc: Vec::new(),
        subject: Some("Contract".to_owned()),
        has_attachments: false,
        bulk: false,
        body: Some(body.to_owned()),
        snippet: Some("snippet".to_owned()),
    }
}

fn thread(messages: Vec<FocusMessage>) -> FocusThread {
    FocusThread {
        thread_id: Uuid::new_v4(),
        link_id: Uuid::new_v4(),
        owner: macro_user_id::user_id::MacroUserIdStr::try_from_email("owner@acme.com").unwrap(),
        owner_email: "owner@acme.com".to_owned(),
        is_signal: true,
        inbox_visible: true,
        classified_message_id: None,
        messages,
        sent_notes: Vec::new(),
    }
}

#[test]
fn new_text_drops_quoted_history() {
    let body = "Sounds good, see you Monday.\n\nOn Mon, Oct 5, 2026 at 9:00 AM Ava <ava@example.com> wrote:\n> Can we meet?\n> Thanks";
    assert_eq!(new_text(body), "Sounds good, see you Monday.");
    assert_eq!(new_text("> only quoted\n> lines"), "");
    assert_eq!(new_text("Thanks!\n\nSent from my iPhone\nmore"), "Thanks!");
    assert_eq!(new_text("Hi\n-----Original Message-----\nFrom: x"), "Hi");
}

#[test]
fn brush_offs() {
    for reply in [
        "I'm not interested",
        "No Thanks",
        "no.",
        "Please remove me from this list",
        "STOP",
    ] {
        assert!(is_dismissive_reply(reply), "{reply}");
    }
    for reply in [
        "Hey Basil! Really sorry, I'll see you tomorrow.",
        "Notice the stopwatch",
        "Sure, stop by at 3pm",
        "Not interested in GPU infrastructure, but we would love to chat about our CI pipeline and the contract terms next week, could you send over the details please",
        "No problem, take your time",
    ] {
        assert!(!is_dismissive_reply(reply), "{reply}");
    }
}

#[test]
fn shows_the_last_three_messages_with_the_profile() {
    let thread = thread(vec![
        message("one", false),
        message("two", true),
        message("three", false),
        message("four", false),
    ]);
    let input = jev_input(&thread, Some("Owner leads engineering at Acme."));
    assert_eq!(
        input["recipient"],
        "The recipient's address is owner@acme.com.\n\nOwner leads engineering at Acme."
    );
    assert_eq!(input["thread"]["message_count"], 4);
    assert_eq!(input["thread"]["earlier_messages_omitted"], 1);
    let shown = input["thread"]["messages"].as_array().unwrap();
    assert_eq!(shown.len(), 3);
    assert_eq!(shown[0]["sent_by_recipient"], true);
    assert_eq!(shown[0]["from"], "Ava <ava@example.com>");
    assert_eq!(shown[0]["date"], "2026-10-06T21:31");
    assert_eq!(input["thread"]["subject"], "Contract");
}

#[test]
fn a_bump_shows_the_quoted_request() {
    let bump = "waiting to hear back\n\nOn Sun, 16 Aug 2026 at 23:55, Sam <sam@example.com> wrote:\n> The /proxy endpoint fetches any URL unauthenticated.";
    let thread = thread(vec![message(bump, false)]);
    let text = jev_input(&thread, None)["thread"]["messages"][0]["text"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(text.contains("fetches any URL"), "{text}");
}

#[test]
fn long_text_is_cut_on_a_character_boundary() {
    let long = "é".repeat(MESSAGE_CHARS + 500);
    let thread = thread(vec![message(&long, false)]);
    let text = jev_input(&thread, None)["thread"]["messages"][0]["text"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(text.chars().count(), MESSAGE_CHARS);
}

#[test]
fn no_profile_means_address_only() {
    let thread = thread(vec![message("hello there", false)]);
    assert_eq!(
        jev_input(&thread, Some("   "))["recipient"],
        "The recipient's address is owner@acme.com."
    );
}

#[test]
fn long_recipient_lists_are_cut() {
    let mut list = message("Quarterly all-hands notes", false);
    list.to = (0..30).map(|n| format!("person{n}@acme.com")).collect();
    list.cc = vec!["cc@acme.com".to_owned()];
    let shown = &jev_input(&thread(vec![list]), None)["thread"]["messages"][0];
    assert_eq!(shown["to"].as_array().unwrap().len(), SHOWN_RECIPIENTS);
    assert_eq!(shown["cc"], json!(["cc@acme.com"]));
    assert_eq!(shown["other_recipients"], 10);

    let short = &jev_input(&thread(vec![message("hi", false)]), None)["thread"]["messages"][0];
    assert!(short.get("other_recipients").is_none());
}
