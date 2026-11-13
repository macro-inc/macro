//! Threads and their previews: which messages share a thread, the order a
//! thread and the inbox list them in, and which threads the inbox shows.

use std::collections::HashSet;
use std::time::Duration;

use email_e2e::{Inbox, Mail, Provider, Report, Stack};
use rootcause::prelude::*;
use serde_json::{Value, json};

/// How many messages the long thread holds: more than two full pages.
const LONG_THREAD: usize = 105;
/// The most messages one read of a thread may ask for.
const PAGE_LIMIT: usize = 100;

/// Moves both providers' clocks forward, so the next message is strictly
/// newer than the last one. Outlook dates have one-second resolution, and
/// two messages of the same second have no order to assert.
fn tick(stack: &Stack, seconds: u64) {
    stack.gmail().advance_clock(Duration::from_secs(seconds));
    stack.outlook().advance_clock(Duration::from_secs(seconds));
}

/// A message from `from` with a `Message-ID` the next one can reply to.
fn mail(from: &str, subject: &str, text: &str, message_id: &str) -> Mail {
    let mut mail = Mail::new(from, subject, text);
    mail.message_id = Some(message_id.to_owned());
    mail
}

fn messages(thread: &Value) -> &[Value] {
    thread["messages"].as_array().map_or(&[], Vec::as_slice)
}

fn has_messages(count: usize) -> impl Fn(&Value) -> bool {
    move |thread| messages(thread).len() == count
}

fn text<'a>(value: &'a Value, field: &str) -> &'a str {
    value[field].as_str().unwrap_or_default()
}

/// One page of a thread: `GET /email/threads/{id}` with the given query.
async fn page(inbox: &Inbox, thread_id: &str, query: &str) -> Result<Vec<Value>, Report> {
    let read = inbox
        .get(&format!("/email/threads/{thread_id}?{query}"))
        .await?
        .ok()?;
    Ok(messages(&read["thread"]).to_vec())
}

/// Where a thread stands in the inbox as the app lists it (newest mail
/// first: `sort_method=updated_at`), the first row being 0.
async fn inbox_position(inbox: &Inbox, thread_id: &str) -> Result<usize, Report> {
    let listed = inbox
        .get("/email/threads/previews/cursor/inbox?limit=500&sort_method=updated_at")
        .await?
        .ok()?;
    listed["items"]
        .as_array()
        .and_then(|rows| rows.iter().position(|row| row["id"] == thread_id))
        .ok_or_else(|| report!("thread {thread_id} is not in the inbox: {listed}"))
}

/// A reply joins the thread of the message it answers, the thread lists its
/// messages newest first with each one's own sender, and the inbox row shows
/// the newest message. When this fails, a conversation is split over several
/// rows, or reads in the wrong order, or the row shows a stale message.
async fn reply_joins_its_thread(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let first = inbox.deliver(&mail(
        "Grace <grace@example.com>",
        "Q3 plan",
        "Here is the plan.",
        "plan-1@example.com",
    ))?;
    let preview = inbox.wait_for_preview("inbox", "Q3 plan").await?;
    let thread_id = text(&preview, "id").to_owned();
    assert_eq!(preview["senderEmail"], "grace@example.com");
    assert_eq!(preview["snippet"], "Here is the plan.");

    tick(&stack, 2);
    let second = inbox.deliver(
        &mail(
            "Alan <alan@example.com>",
            "Re: Q3 plan",
            "Looks right to me.",
            "plan-2@example.com",
        )
        .in_reply_to("plan-1@example.com"),
    )?;
    tick(&stack, 2);
    let third = inbox.deliver(
        &mail(
            "Barbara <barbara@example.com>",
            "Re: Q3 plan",
            "One change on page two.",
            "plan-3@example.com",
        )
        .in_reply_to("plan-2@example.com"),
    )?;

    let thread = inbox
        .wait_for_thread(
            &thread_id,
            "the thread to hold all three messages",
            has_messages(3),
        )
        .await?;
    let listed: Vec<(&str, &str, &str)> = messages(&thread)
        .iter()
        .map(|message| {
            (
                text(&message["from"], "email"),
                text(&message["from"], "name"),
                text(message, "body_text").trim_end(),
            )
        })
        .collect();
    assert_eq!(
        listed,
        [
            ("barbara@example.com", "Barbara", "One change on page two."),
            ("alan@example.com", "Alan", "Looks right to me."),
            ("grace@example.com", "Grace", "Here is the plan."),
        ],
        "a thread lists its messages newest first, each with its own sender"
    );
    for message in messages(&thread) {
        assert_eq!(message["thread_db_id"], thread_id.as_str());
        assert_eq!(message["to"][0]["email"], ada.email());
    }

    // The inbox has one row for the conversation, showing its newest message.
    let row = inbox
        .wait_for_preview_where("inbox", "the row to show the newest reply", |preview| {
            preview["id"] == thread_id.as_str() && preview["senderEmail"] == "barbara@example.com"
        })
        .await?;
    assert_eq!(row["name"], "Re: Q3 plan");
    assert_eq!(row["snippet"], "One change on page two.");
    assert_eq!(row["senderName"], "Barbara");
    assert_eq!(row["isRead"], false);
    assert_eq!(inbox.previews("inbox").await?.len(), 1);

    // The provider put them in one thread too, and Macro's thread is that one.
    assert_eq!(first.thread_id, second.thread_id);
    assert_eq!(first.thread_id, third.thread_id);
    assert_eq!(row["providerId"], first.thread_id.as_str());

    stack.finish().await
}

/// A reply arriving on a thread the user had read makes the thread unread
/// again and moves it above newer threads in the inbox. When this fails, new
/// mail on an old conversation goes unnoticed.
async fn reply_reopens_a_read_thread(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    inbox.deliver(&mail(
        "Grace <grace@example.com>",
        "Venue",
        "Is the hall free?",
        "venue-1@example.com",
    ))?;
    let venue = inbox.wait_for_preview("inbox", "Venue").await?;
    let venue_id = text(&venue, "id").to_owned();
    tick(&stack, 2);
    inbox.deliver(&Mail::new(
        "Alan <alan@example.com>",
        "Catering",
        "Menu attached.",
    ))?;
    let catering = inbox.wait_for_preview("inbox", "Catering").await?;
    let catering_id = text(&catering, "id").to_owned();

    inbox
        .patch(
            &format!("/email/threads/{venue_id}/state"),
            Some(&json!({ "field": "read", "value": true })),
        )
        .await?
        .ok()?;
    inbox
        .wait_for_preview_where("inbox", "the older thread to be read", |preview| {
            preview["id"] == venue_id.as_str() && preview["isRead"] == true
        })
        .await?;
    assert!(
        inbox_position(&inbox, &catering_id).await? < inbox_position(&inbox, &venue_id).await?,
        "the newer thread is listed first"
    );

    tick(&stack, 2);
    inbox.deliver(
        &mail(
            "Grace <grace@example.com>",
            "Re: Venue",
            "It is, I booked it.",
            "venue-2@example.com",
        )
        .in_reply_to("venue-1@example.com"),
    )?;
    let reopened = inbox
        .wait_for_preview_where(
            "inbox",
            "the reply to show on the older thread",
            |preview| {
                preview["id"] == venue_id.as_str() && preview["snippet"] == "It is, I booked it."
            },
        )
        .await?;
    assert_eq!(
        reopened["isRead"], false,
        "new mail makes a read thread unread"
    );
    assert!(
        inbox_position(&inbox, &venue_id).await? < inbox_position(&inbox, &catering_id).await?,
        "the thread with the newest mail is listed first"
    );

    let thread = inbox.thread(&venue_id).await?;
    assert_eq!(thread["is_read"], false);
    let read: Vec<bool> = messages(&thread)
        .iter()
        .map(|message| message["is_read"] == true)
        .collect();
    assert_eq!(read, [false, true], "only the new message is unread");

    stack.finish().await
}

/// Two unrelated messages with the same subject stay two threads: Macro
/// follows the provider's threading, and a subject alone joins nothing. When
/// this fails, strangers' mail named "Invoice" piles into one conversation.
async fn same_subject_does_not_merge(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let from_grace = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Invoice",
        "For October.",
    ))?;
    tick(&stack, 2);
    let from_alan = inbox.deliver(&Mail::new(
        "Alan <alan@example.com>",
        "Invoice",
        "For the venue.",
    ))?;
    assert_ne!(
        from_grace.thread_id, from_alan.thread_id,
        "the provider keeps them apart"
    );

    inbox
        .wait_for_preview_where("inbox", "the second message's row", |preview| {
            preview["senderEmail"] == "alan@example.com"
        })
        .await?;
    let rows = inbox
        .wait_for_preview_where("inbox", "the first message's row", |preview| {
            preview["senderEmail"] == "grace@example.com"
        })
        .await
        .and(inbox.previews("inbox").await)?;
    assert_eq!(rows.len(), 2, "one row per provider thread");
    let threads: HashSet<&str> = rows.iter().map(|row| text(row, "providerId")).collect();
    assert_eq!(
        threads,
        HashSet::from([from_grace.thread_id.as_str(), from_alan.thread_id.as_str()])
    );
    for row in &rows {
        assert_eq!(row["name"], "Invoice");
        let thread = inbox.thread(text(row, "id")).await?;
        assert_eq!(messages(&thread).len(), 1);
    }

    stack.finish().await
}

/// A thread with more messages than one page holds is read in pages that
/// together hold every message once, newest first. When this fails, a long
/// conversation shows a message twice or never.
async fn long_thread_pages_through_every_message(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;

    // The mailbox holds the whole conversation before it is linked.
    let started = stack.gmail().now() - Duration::from_secs(24 * 60 * 60);
    let message_id = |number: usize| format!("long-{number}@example.com");
    match provider {
        Provider::Gmail => stack.gmail().add_mailbox(&gmail_emulator::SeedMailbox {
            messages: (0..LONG_THREAD)
                .map(|number| gmail_emulator::NewMessage {
                    from: Some(format!(
                        "Writer {number} <writer{}@example.com>",
                        number % 3
                    )),
                    subject: Some("Long thread".to_owned()),
                    text: Some(format!("Message {number}")),
                    date: Some(started + Duration::from_secs(60 * number as u64)),
                    message_id: Some(message_id(number)),
                    in_reply_to: number.checked_sub(1).map(message_id),
                    ..Default::default()
                })
                .collect(),
            ..gmail_emulator::SeedMailbox::new(ada.email())
        })?,
        Provider::Outlook => stack
            .outlook()
            .add_mailbox(&outlook_emulator::SeedMailbox {
                messages: (0..LONG_THREAD)
                    .map(|number| outlook_emulator::NewMessage {
                        from: Some(format!(
                            "Writer {number} <writer{}@example.com>",
                            number % 3
                        )),
                        subject: Some("Long thread".to_owned()),
                        text: Some(format!("Message {number}")),
                        date: Some(started + Duration::from_secs(60 * number as u64)),
                        message_id: Some(message_id(number)),
                        in_reply_to: number.checked_sub(1).map(message_id),
                        ..Default::default()
                    })
                    .collect(),
                ..outlook_emulator::SeedMailbox::new(ada.email())
            })?,
    }
    let inbox = ada.link(provider, ada.email()).await?;

    let row = inbox.wait_for_preview("inbox", "Long thread").await?;
    let thread_id = text(&row, "id").to_owned();
    // The first page fills up before the import ends; the last one says when
    // every message is in.
    let last_offset = LONG_THREAD - 5;
    email_e2e::eventually(
        "the thread to hold every message",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            let tail = page(
                &inbox,
                &thread_id,
                &format!("offset={last_offset}&limit=10"),
            )
            .await?;
            Ok((tail.len() == 5).then_some(()))
        },
    )
    .await?;
    // The row as it is now that every message is in.
    let row = inbox.wait_for_preview("inbox", "Long thread").await?;

    let mut bodies = Vec::new();
    let mut ids = HashSet::new();
    for offset in (0..LONG_THREAD + 50).step_by(50) {
        let read = page(&inbox, &thread_id, &format!("offset={offset}&limit=50")).await?;
        assert_eq!(read.len(), LONG_THREAD.saturating_sub(offset).min(50));
        for message in &read {
            ids.insert(text(message, "db_id").to_owned());
            bodies.push(text(message, "body_text").trim_end().to_owned());
        }
    }
    let newest_first: Vec<String> = (0..LONG_THREAD)
        .rev()
        .map(|number| format!("Message {number}"))
        .collect();
    assert_eq!(
        bodies, newest_first,
        "the pages hold every message, newest first"
    );
    assert_eq!(ids.len(), LONG_THREAD, "no message is on two pages");

    // The page sizes the API promises: five by default, at most a hundred.
    assert_eq!(page(&inbox, &thread_id, "").await?.len(), 5);
    assert_eq!(
        page(&inbox, &thread_id, &format!("limit={PAGE_LIMIT}"))
            .await?
            .len(),
        PAGE_LIMIT
    );
    let too_many = inbox
        .get(&format!(
            "/email/threads/{thread_id}?limit={}",
            PAGE_LIMIT + 1
        ))
        .await?;
    assert_eq!(too_many.status, 400);

    // The row shows the newest of them.
    assert_eq!(row["snippet"], format!("Message {}", LONG_THREAD - 1));
    assert_eq!(
        row["senderEmail"],
        format!("writer{}@example.com", (LONG_THREAD - 1) % 3)
    );

    stack.finish().await
}

/// A reply draft has no date of its own. It must not hide the thread's real
/// messages: the page a preview reads still holds a sent or received message
/// with the subject, and once newer mail arrives the newest-message read
/// (`limit=1`) answers that mail, not the draft. When this fails, a mention
/// or preview of the thread shows "No Subject".
async fn dateless_draft_does_not_head_the_thread(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    inbox.deliver(&mail(
        "Grace <grace@example.com>",
        "Q3 plan",
        "Here is the plan.",
        "q3-1@example.com",
    ))?;
    let preview = inbox.wait_for_preview("inbox", "Q3 plan").await?;
    let thread_id = text(&preview, "id").to_owned();
    inbox.deliver(
        &mail(
            "Alan <alan@example.com>",
            "Re: Q3 plan",
            "Looks right to me.",
            "q3-2@example.com",
        )
        .in_reply_to("q3-1@example.com"),
    )?;
    let thread = inbox
        .wait_for_thread(
            &thread_id,
            "the thread to hold both messages",
            has_messages(2),
        )
        .await?;
    let replying_to = messages(&thread)
        .iter()
        .find(|message| message["from"]["email"] == "alan@example.com")
        .map(|message| message["db_id"].clone())
        .unwrap_or_default();

    // A reply the user started and left: no subject, never sent.
    let draft = inbox
        .save_draft(&json!({
            "subject": "",
            "to": [{ "email": "alan@example.com" }],
            "body_text": "Thanks, I will",
            "replying_to_id": replying_to,
            "thread_db_id": thread_id,
        }))
        .await?;
    assert_eq!(draft["thread_db_id"], thread_id.as_str());
    let draft_id = text(&draft, "db_id").to_owned();

    // What a mention preview reads: the default page.
    let default_page = page(&inbox, &thread_id, "").await?;
    assert_eq!(default_page.len(), 3);
    let named_by = default_page
        .iter()
        .find(|message| message["is_draft"] != true && !text(message, "subject").is_empty());
    // The two real messages may share a second, so either may come first:
    // what matters is that one of them, not the draft, names the thread.
    assert!(
        named_by.is_some_and(|message| text(message, "subject").ends_with("Q3 plan")),
        "no sent or received message names the thread: {default_page:?}"
    );
    let stored_draft = default_page
        .iter()
        .find(|message| message["db_id"] == draft_id.as_str())
        .ok_or_else(|| report!("the thread does not list the draft"))?;
    assert_eq!(stored_draft["is_draft"], true);
    assert_eq!(
        stored_draft["internal_date_ts"],
        Value::Null,
        "the scenario needs a draft without a date"
    );

    // Newer mail arrives on the thread.
    tick(&stack, 60);
    inbox.deliver(
        &mail(
            "Grace <grace@example.com>",
            "Re: Q3 plan",
            "Any news?",
            "q3-3@example.com",
        )
        .in_reply_to("q3-2@example.com"),
    )?;
    inbox
        .wait_for_thread(
            &thread_id,
            "the thread to hold the new message",
            has_messages(4),
        )
        .await?;

    let newest = page(&inbox, &thread_id, "limit=1").await?;
    assert_eq!(newest.len(), 1);
    assert_eq!(
        (
            newest[0]["is_draft"].as_bool(),
            text(&newest[0], "subject"),
            text(&newest[0]["from"], "email"),
        ),
        (Some(false), "Re: Q3 plan", "grace@example.com"),
        "the newest message of the thread is the mail that just arrived, not the dateless draft"
    );

    // One message per page walks the thread in the same order as one read.
    let whole: Vec<Value> = page(&inbox, &thread_id, "limit=10")
        .await?
        .iter()
        .map(|message| message["db_id"].clone())
        .collect();
    let mut walked = Vec::new();
    for offset in 0..whole.len() {
        let one = page(&inbox, &thread_id, &format!("limit=1&offset={offset}")).await?;
        walked.extend(one.iter().map(|message| message["db_id"].clone()));
    }
    assert_eq!(walked, whole);
    assert_eq!(whole.len(), 4);
    assert_eq!(
        whole[1],
        draft_id.as_str(),
        "the draft sorts by when it was written: after the new mail, before the older"
    );

    stack.finish().await
}

/// The inbox shows conversations with received mail. A draft to someone new
/// and a sent message nobody answered are not in it, while a reply draft
/// brings an archived received thread back, also once the provider holds the
/// draft. When this fails, the inbox fills with the user's own unsent and
/// sent mail, or a reply in progress vanishes from it.
async fn inbox_lists_only_threads_with_received_mail(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let graces = grace.link(provider, grace.email()).await?;

    // A received thread, archived.
    let contract = inbox.deliver(&mail(
        "Alan <alan@example.com>",
        "Contract",
        "Please sign.",
        "contract-1@example.com",
    ))?;
    let received = inbox.wait_for_preview("inbox", "Contract").await?;
    let contract_id = text(&received, "id").to_owned();
    inbox
        .patch(
            &format!("/email/threads/{contract_id}/archived"),
            Some(&json!({ "value": true })),
        )
        .await?
        .ok()?;
    inbox
        .wait_for_provider_message("the archived message to leave the inbox", |message| {
            message.id == contract.id && !message.in_inbox
        })
        .await?;
    inbox
        .wait_for_preview_where("all", "the archived thread to leave the inbox", |preview| {
            preview["id"] == contract_id.as_str() && preview["inboxVisible"] == false
        })
        .await?;

    // (a) A draft to someone new.
    let draft = inbox
        .save_draft(&json!({
            "subject": "Only a draft",
            "to": [{ "email": "nobody@example.com" }],
            "body_text": "Not sent yet.",
        }))
        .await?;
    let draft_thread = text(&draft, "thread_db_id").to_owned();
    inbox.wait_for_preview("drafts", "Only a draft").await?;

    // (b) A sent message nobody answered.
    inbox
        .send(&json!({
            "subject": "Only sent",
            "to": [{ "email": grace.email() }],
            "body_text": "No answer needed.",
        }))
        .await?;
    graces.wait_for_preview("inbox", "Only sent").await?;
    let sent = inbox.wait_for_preview("sent", "Only sent").await?;
    let sent_thread = text(&sent, "id").to_owned();

    // (c) A reply draft on the archived thread.
    let reply = inbox
        .save_draft(&json!({
            "subject": "Re: Contract",
            "to": [{ "email": "alan@example.com" }],
            "body_text": "Signed copy to follow.",
            "replying_to_id": inbox.thread(&contract_id).await?["messages"][0]["db_id"],
            "thread_db_id": contract_id,
        }))
        .await?;
    assert_eq!(reply["thread_db_id"], contract_id.as_str());
    inbox
        .wait_for_preview_where(
            "inbox",
            "the reply draft to bring its thread back",
            |preview| preview["id"] == contract_id.as_str(),
        )
        .await?;

    // Outlook stores Macro's drafts in the mailbox; Gmail drafts stay in
    // Macro. Wait until both drafts have their provider message, which is
    // when a synced draft used to stop counting as one.
    if provider == Provider::Outlook {
        for (thread_id, subject) in [
            (&draft_thread, "Only a draft"),
            (&contract_id, "Re: Contract"),
        ] {
            inbox
                .wait_for_provider_message("the draft to be stored at the provider", |message| {
                    message.subject == subject
                })
                .await?;
            inbox
                .wait_for_thread(
                    thread_id,
                    "the draft to know its provider message",
                    |thread| {
                        messages(thread).iter().any(|message| {
                            message["is_draft"] == true && message["provider_id"].is_string()
                        })
                    },
                )
                .await?;
        }
    }

    // Everything above has settled once a later message has arrived.
    tick(&stack, 2);
    inbox.deliver(&Mail::new("Zoe <zoe@example.com>", "Later", "Marker."))?;
    inbox.wait_for_preview("inbox", "Later").await?;

    let rows = inbox.previews("inbox").await?;
    let listed: HashSet<&str> = rows.iter().map(|row| text(row, "id")).collect();
    assert!(
        !listed.contains(draft_thread.as_str()),
        "a thread that is only a draft is not in the inbox: {rows:?}"
    );
    assert!(
        !listed.contains(sent_thread.as_str()),
        "a thread that is only sent mail is not in the inbox: {rows:?}"
    );
    assert!(
        listed.contains(contract_id.as_str()),
        "a reply draft keeps its received thread in the inbox: {rows:?}"
    );
    assert_eq!(
        listed.len(),
        2,
        "the inbox holds the two received threads: {rows:?}"
    );

    for (thread_id, received_mail) in [
        (&draft_thread, false),
        (&sent_thread, false),
        (&contract_id, true),
    ] {
        let thread = inbox.thread(thread_id).await?;
        assert_eq!(thread["has_received_mail"], received_mail);
        assert_eq!(thread["inbox_visible"], received_mail);
    }
    // They are where the user looks for them instead.
    inbox.wait_for_preview("drafts", "Only a draft").await?;
    inbox.wait_for_preview("sent", "Only sent").await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_reply_joins_its_thread() -> Result<(), Report> {
    reply_joins_its_thread(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_reply_joins_its_thread() -> Result<(), Report> {
    reply_joins_its_thread(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_reply_reopens_a_read_thread() -> Result<(), Report> {
    reply_reopens_a_read_thread(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_reply_reopens_a_read_thread() -> Result<(), Report> {
    reply_reopens_a_read_thread(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_same_subject_does_not_merge() -> Result<(), Report> {
    same_subject_does_not_merge(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_same_subject_does_not_merge() -> Result<(), Report> {
    same_subject_does_not_merge(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_long_thread_pages_through_every_message() -> Result<(), Report> {
    long_thread_pages_through_every_message(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_long_thread_pages_through_every_message() -> Result<(), Report> {
    long_thread_pages_through_every_message(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_dateless_draft_does_not_head_the_thread() -> Result<(), Report> {
    dateless_draft_does_not_head_the_thread(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_dateless_draft_does_not_head_the_thread() -> Result<(), Report> {
    dateless_draft_does_not_head_the_thread(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_inbox_lists_only_threads_with_received_mail() -> Result<(), Report> {
    inbox_lists_only_threads_with_received_mail(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_inbox_lists_only_threads_with_received_mail() -> Result<(), Report> {
    inbox_lists_only_threads_with_received_mail(Provider::Outlook).await
}
