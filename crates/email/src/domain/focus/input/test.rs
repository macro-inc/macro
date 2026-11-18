use chrono::{TimeZone, Utc};
use chrono_tz::America::Los_Angeles;
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
        to: vec!["owner@acme.example".to_owned()],
        cc: Vec::new(),
        subject: Some("Contract".to_owned()),
        has_attachments: false,
        bulk: false,
        calendar_part: None,
        body: Some(body.to_owned()),
        snippet: Some("snippet".to_owned()),
        date_header: None,
    }
}

fn thread(messages: Vec<FocusMessage>) -> FocusThread {
    FocusThread {
        thread_id: Uuid::new_v4(),
        link_id: Uuid::new_v4(),
        owner: macro_user_id::user_id::MacroUserIdStr::try_from_email("owner@acme.example")
            .unwrap(),
        owner_email: "owner@acme.example".to_owned(),
        is_signal: true,
        inbox_visible: true,
        classified: None,
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
fn closing_replies_owe_nobody_an_answer() {
    for reply in [
        "Thanks!",
        "Thank you so much",
        "thx",
        "Got it, thanks",
        "Sounds good.",
        "Thanks Ava!\n\nOwner\nFounder, Acme",
        "Thanks!\nAlex Smith",
        "Thanks,\nBest,\nOwner",
        "Thanks!\n\n-- \nOwner Name\nFounder, Acme",
        "No thanks",
    ] {
        assert!(is_closing_reply(reply), "{reply}");
    }
    for reply in [
        "",
        "Thanks, can you send the contract?",
        "Thanks!\n\nAlso, when can you start?",
        "Thanks, please send pricing",
        "Thanks!\nPlease send the signed contract.",
        "Thanks!\nPlease confirm",
        "Thanks!\nPlease send pricing",
        "Ok, send me the contract",
        "Thanks for the intro. I would love to hear how the pilot went and what you would change.",
        "Thanksgiving works for us",
        "Okay to send the draft Monday morning to the whole team",
        "Here is the contract to sign",
    ] {
        assert!(!is_closing_reply(reply), "{reply}");
    }
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
        "The recipient's address is owner@acme.example.\n\nOwner leads engineering at Acme."
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
        "The recipient's address is owner@acme.example."
    );
}

#[test]
fn long_recipient_lists_are_cut() {
    let mut list = message("Quarterly all-hands notes", false);
    list.to = (0..30).map(|n| format!("person{n}@acme.example")).collect();
    list.cc = vec!["cc@acme.example".to_owned()];
    let shown = &jev_input(&thread(vec![list]), None)["thread"]["messages"][0];
    assert_eq!(shown["to"].as_array().unwrap().len(), SHOWN_RECIPIENTS);
    assert_eq!(shown["cc"], json!(["cc@acme.example"]));
    assert_eq!(shown["other_recipients"], 10);

    let short = &jev_input(&thread(vec![message("hi", false)]), None)["thread"]["messages"][0];
    assert!(short.get("other_recipients").is_none());
}

fn day(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).unwrap()
}

/// Written at 02:00 UTC on October 8, the evening before in the Americas.
fn written_late(date_header: Option<&str>) -> FocusMessage {
    FocusMessage {
        at: Utc.with_ymd_and_hms(2026, 10, 8, 2, 0, 0).unwrap(),
        date_header: date_header.map(str::to_owned),
        ..message("Please send it by Friday.", false)
    }
}

#[test]
fn someone_elses_message_counts_from_the_offset_they_wrote_at() {
    // Their "tomorrow", written at 03:00 on the 8th, means the 9th, though it was
    // still the 7th for an owner in Los Angeles.
    let message = written_late(Some("Thu, 8 Oct 2026 03:00:00 +0100"));
    assert_eq!(written_on(&message, Some(Los_Angeles)), day(2026, 10, 8));
    // A comment after the offset, as many mail servers add.
    let message = written_late(Some("Wed, 7 Oct 2026 21:00:00 -0500 (CDT)"));
    assert_eq!(written_on(&message, None), day(2026, 10, 7));
}

#[test]
fn the_owners_own_message_counts_from_the_owners_time_zone() {
    // Mail sent through a service can carry a UTC stamp.
    let message = FocusMessage {
        is_sent: true,
        ..written_late(Some("Thu, 8 Oct 2026 02:00:00 +0000"))
    };
    assert_eq!(written_on(&message, Some(Los_Angeles)), day(2026, 10, 7));
    assert_eq!(written_on(&message, None), day(2026, 10, 8));
}

#[test]
fn with_no_readable_header_someone_elses_message_counts_from_the_owners_time_zone() {
    assert_eq!(
        written_on(&written_late(None), Some(Los_Angeles)),
        day(2026, 10, 7)
    );
    let unreadable = written_late(Some("yesterday-ish"));
    assert_eq!(written_on(&unreadable, Some(Los_Angeles)), day(2026, 10, 7));
}

#[test]
fn with_nothing_else_to_go_on_a_message_counts_from_its_utc_day() {
    assert_eq!(written_on(&written_late(None), None), day(2026, 10, 8));
    let unreadable = written_late(Some("yesterday-ish"));
    assert_eq!(written_on(&unreadable, None), day(2026, 10, 8));
}

#[test]
fn the_due_date_input_reads_a_replys_own_words_and_never_its_quoted_history() {
    // Jev gets the whole of a short reply; a quoted "by Friday" here would count
    // from this reply's date.
    let reply = message(
        "Any news?\n\nOn Tue, Oct 6, 2026 at 9:00 AM Ava <ava@example.com> wrote:\n> Send it by Friday.",
        false,
    );
    let input = due_date_input(&thread(vec![reply]), None);

    assert_eq!(input.messages[0].text, "Any news?");
}

#[test]
fn the_due_date_input_leaves_out_messages_with_no_words_of_their_own() {
    let only_quoted = message("> Send it by Friday.", false);
    let spoken = message("By Monday, please.", false);
    let input = due_date_input(&thread(vec![only_quoted, spoken]), None);

    assert_eq!(input.messages.len(), 1);
    assert_eq!(input.messages[0].text, "By Monday, please.");
}

#[test]
fn the_due_date_input_falls_back_to_a_snippet_only_with_no_body() {
    let no_body = FocusMessage {
        body: None,
        snippet: Some("Please reply by Friday".to_owned()),
        ..message("", false)
    };
    let input = due_date_input(&thread(vec![no_body]), None);

    assert_eq!(input.messages[0].text, "Please reply by Friday");
}

#[test]
fn a_deadline_stays_in_view_through_replies_that_never_mention_it() {
    let mut messages = vec![message("Please send it by Friday.", false)];
    messages.extend((0..4).map(|number| message(&format!("Reply {number}"), number % 2 == 0)));
    let thread = thread(messages);

    let input = due_date_input(&thread, None);

    // Past what Jev is shown, whose window would have dropped it.
    assert_eq!(input.messages.len(), 5);
    assert_eq!(input.messages[0].text, "Please send it by Friday.");
    assert_eq!(input.subject.as_deref(), Some("Contract"));
    let shown = jev_input(&thread, None);
    assert_eq!(shown["thread"]["messages"].as_array().unwrap().len(), 3);
}

#[test]
fn the_due_date_input_is_bounded_counting_back_from_the_latest() {
    let messages = (0..DUE_DATE_MESSAGES + 2)
        .map(|number| message(&format!("Message {number}"), false))
        .collect::<Vec<_>>();

    let input = due_date_input(&thread(messages), None);

    assert_eq!(input.messages.len(), DUE_DATE_MESSAGES);
    assert_eq!(input.messages[0].text, "Message 2");
}

#[test]
fn the_due_date_input_marks_the_owners_messages_and_names_no_sender() {
    let input = due_date_input(&thread(vec![message("Sent it over.", true)]), None);

    assert!(input.messages[0].from_owner);
    let shown = format!("{input:?}");
    assert!(!shown.contains("ava@example.com") && !shown.contains("Ava"));
}

#[test]
fn the_due_date_input_collapses_wrapped_lines_and_bounds_each_message() {
    let wrapped = message("Please send it\nby\n  Friday.", false);
    let long = message(&"a".repeat(MESSAGE_CHARS + 50), false);
    let input = due_date_input(&thread(vec![wrapped, long]), None);

    assert_eq!(input.messages[0].text, "Please send it by Friday.");
    assert_eq!(input.messages[1].text.chars().count(), MESSAGE_CHARS);
}
