//! Send later and undo: a schedule holds the message until its time, sends
//! what was committed, and an undo gives the draft back.

#[path = "send_support/support.rs"]
mod support;

use email_e2e::{ApiResponse, Inbox, Mail, Provider, Report, Stack, StackOptions};
use rootcause::prelude::*;
use serde_json::{Value, json};
use support::{first_message, html, message_in_thread, provider_copies, wait_for_wire};
use uuid::Uuid;

/// A send time no scenario reaches.
const LATER: &str = "2099-01-01T09:00:00Z";
/// A second send time, for a reschedule.
const EVEN_LATER: &str = "2099-06-01T09:00:00Z";
/// A send time that has passed.
const PAST: &str = "2001-01-01T09:00:00Z";
/// The queue the scheduled-send sweep feeds.
const SCHEDULED_QUEUE: &str = "scheduled";
/// The variable holding the length of the undo window, in seconds.
const UNDO_WINDOW: &str = "SENT_UNDO_DELAY_SECS";
/// An undo window no scenario outlasts, so an undo never races delivery.
const LONG_UNDO_WINDOW: &str = "600";

/// A stack whose undo window stays open for the whole scenario.
async fn stack_with_open_undo_window() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        env: vec![(UNDO_WINDOW.to_owned(), LONG_UNDO_WINDOW.to_owned())],
    })
    .await
}

/// A field of a JSON object that must be a string.
fn text<'a>(value: &'a Value, field: &str) -> Result<&'a str, Report> {
    match value[field].as_str() {
        Some(text) => Ok(text),
        None => bail!("no {field} in {value}"),
    }
}

/// `PUT /email/drafts/scheduled/{id}`: commit the draft for `send_time`.
async fn schedule(
    inbox: &Inbox,
    draft_id: &str,
    generation: i64,
    send_time: &str,
) -> Result<ApiResponse, Report> {
    inbox
        .put(
            &format!("/email/drafts/scheduled/{draft_id}?draft_generation={generation}"),
            Some(&json!({ "send_time": send_time })),
        )
        .await
}

/// `DELETE /email/drafts/scheduled/{id}`: cancel a schedule, or undo a send.
async fn cancel(inbox: &Inbox, message_id: &str, generation: i64) -> Result<ApiResponse, Report> {
    inbox
        .delete(
            &format!("/email/drafts/scheduled/{message_id}?draft_generation={generation}"),
            None,
        )
        .await
}

/// The inbox's scheduled messages, as the Scheduled tab lists them.
async fn scheduled(inbox: &Inbox) -> Result<Vec<Value>, Report> {
    let listed = inbox.get("/email/drafts/scheduled").await?.ok()?;
    Ok(listed["messages"].as_array().cloned().unwrap_or_default())
}

/// The message as the thread view shows it; an error when it is not there.
async fn stored(inbox: &Inbox, thread_id: &str, message_id: &str) -> Result<Value, Report> {
    let message = message_in_thread(inbox, thread_id, message_id).await?;
    if message.is_null() {
        bail!("the thread {thread_id} does not list the message {message_id}");
    }
    Ok(message)
}

/// The generation a write to the message must name now.
async fn generation(inbox: &Inbox, thread_id: &str, message_id: &str) -> Result<i64, Report> {
    let message = stored(inbox, thread_id, message_id).await?;
    match message["draft_generation"].as_i64() {
        Some(generation) => Ok(generation),
        None => bail!("the message has no draft_generation: {message}"),
    }
}

/// The queue message that asks the workers to deliver one message: what a
/// send leaves on the queue for its time, and what the sweep enqueues.
async fn sweep(stack: &Stack, inbox: &Inbox, message_id: &str) -> Result<(), Report> {
    stack
        .send_to_queue(
            SCHEDULED_QUEUE,
            &json!({ "link_id": inbox.link_id(), "message_id": message_id }),
        )
        .await
}

/// Lets the message's send time pass, which only the clock does in
/// production, runs the real sweep, and delivers the message's own queue
/// message, which a send leaves with a delay the scenario does not wait out.
async fn come_due(stack: &Stack, inbox: &Inbox, message_id: &str) -> Result<(), Report> {
    let id = Uuid::parse_str(message_id).context("the message id is not a UUID")?;
    let moved = sqlx::query(
        "UPDATE email_scheduled_messages SET send_time = now() - interval '1 second' \
         WHERE message_id = $1 AND link_id = $2",
    )
    .bind(id)
    .bind(inbox.link_id())
    .execute(stack.db())
    .await
    .context("could not move the send time")?;
    if moved.rows_affected() != 1 {
        bail!("the message {message_id} has no schedule to bring forward");
    }
    stack.run_scheduled_sweep().await?;
    sweep(stack, inbox, message_id).await
}

/// Sends a second message, lets its undo window pass, and waits until the
/// recipient's provider has it: whatever the workers were going to deliver
/// before it is delivered by now.
async fn flush(stack: &Stack, from: &Inbox, to: &Inbox, subject: &str) -> Result<(), Report> {
    let marker = from
        .send(&json!({
            "subject": subject,
            "to": [{ "email": to.email() }],
            "body_text": "Marker.",
        }))
        .await?;
    come_due(stack, from, text(&marker, "db_id")?).await?;
    wait_for_wire(stack, to, subject).await?;
    Ok(())
}

/// A draft scheduled for later is listed as scheduled with its time, stays
/// undelivered, can be moved to another time, and becomes an ordinary draft
/// again when the schedule is cancelled. A time in the past is refused.
/// Failing means Send Later sends at once, loses the message, or leaves it
/// stuck after a cancel.
async fn scheduled_message_waits_for_its_time(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    let draft = from
        .save_draft(&json!({
            "subject": "Launch plan",
            "to": [{ "email": grace.email() }],
            "body_text": "We launch in January.",
        }))
        .await?;
    let id = text(&draft, "db_id")?.to_owned();
    let thread = text(&draft, "thread_db_id")?.to_owned();
    let current = generation(&from, &thread, &id).await?;

    let refused = schedule(&from, &id, current, PAST).await?;
    assert_eq!(
        refused.status, 400,
        "a send time in the past was not refused: {}",
        refused.text
    );
    assert!(scheduled(&from).await?.is_empty());

    schedule(&from, &id, current, LATER).await?.ok()?;
    let listed = scheduled(&from).await?;
    assert_eq!(listed.len(), 1, "the Scheduled tab lists {listed:?}");
    assert_eq!(listed[0]["db_id"], id.as_str());
    assert!(
        text(&listed[0], "scheduled_send_time")?.starts_with("2099-01-01T09:00:00"),
        "the scheduled message shows the wrong time: {}",
        listed[0]
    );

    let current = generation(&from, &thread, &id).await?;
    schedule(&from, &id, current, EVEN_LATER).await?.ok()?;
    let listed = scheduled(&from).await?;
    assert_eq!(listed.len(), 1, "a reschedule duplicated the message");
    assert!(
        text(&listed[0], "scheduled_send_time")?.starts_with("2099-06-01T09:00:00"),
        "the reschedule did not move the time: {}",
        listed[0]
    );

    // A sweep that runs early changes nothing: the time has not come.
    stack.run_scheduled_sweep().await?;
    sweep(&stack, &from, &id).await?;
    flush(&stack, &from, &to, "Marker before the launch").await?;
    assert!(
        provider_copies(&to, "Launch plan")?.is_empty(),
        "a message scheduled for later was delivered"
    );
    assert_eq!(scheduled(&from).await?.len(), 1);

    let current = generation(&from, &thread, &id).await?;
    let cancelled = cancel(&from, &id, current).await?;
    assert_eq!(cancelled.status, 204, "{}", cancelled.text);
    assert!(scheduled(&from).await?.is_empty());
    let message = stored(&from, &thread, &id).await?;
    assert_eq!(message["is_draft"], true, "{message}");
    assert_eq!(message["is_sent"], false, "{message}");

    // It is an ordinary draft again: the next save goes through.
    let current = generation(&from, &thread, &id).await?;
    from.save_draft(&json!({
        "db_id": id,
        "draft_generation": current,
        "subject": "Launch plan",
        "to": [{ "email": grace.email() }],
        "body_text": "We launch in February.",
    }))
    .await?;
    let message = stored(&from, &thread, &id).await?;
    assert_eq!(message["body_text"], "We launch in February.");

    stack.finish().await
}

/// A scheduled message is committed: the recipient gets the content and the
/// attachment the draft had when it was scheduled, and until the schedule is
/// cancelled a later autosave or discard of that draft is refused. Failing
/// means a scheduled send goes out with content its sender never committed,
/// without its attachment, or not at all.
async fn scheduled_message_goes_out_as_committed(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    let draft = from
        .save_draft(&json!({
            "subject": "Minutes",
            "to": [{ "email": grace.email() }],
            "body_text": "Version one.",
            "body_html": html("<html><body><div>Version one.</div></body></html>"),
        }))
        .await?;
    let id = text(&draft, "db_id")?.to_owned();
    let thread = text(&draft, "thread_db_id")?.to_owned();

    // The last edit and the attachment land right before the schedule.
    let current = generation(&from, &thread, &id).await?;
    from.save_draft(&json!({
        "db_id": id,
        "draft_generation": current,
        "subject": "Minutes",
        "to": [{ "email": grace.email() }],
        "body_text": "Version two.",
        "body_html": html("<html><body><div>Version two.</div></body></html>"),
    }))
    .await?;
    let current = generation(&from, &thread, &id).await?;
    from.attach_to_draft(&id, current, "minutes.txt", b"Agreed: ship it.")
        .await?;
    let current = generation(&from, &thread, &id).await?;
    schedule(&from, &id, current, LATER).await?.ok()?;

    // The composer's autosave and a discard arrive after the commit.
    let committed = generation(&from, &thread, &id).await?;
    let autosave = from
        .post(
            "/email/drafts",
            Some(&json!({ "draft": {
                "db_id": id,
                "draft_generation": committed,
                "subject": "Minutes",
                "to": [{ "email": grace.email() }],
                "body_text": "Version three.",
                "body_html": html("<html><body><div>Version three.</div></body></html>"),
            }})),
        )
        .await?;
    assert!(
        (400..500).contains(&autosave.status),
        "a save changed a message committed for delivery ({}): {}",
        autosave.status,
        autosave.text
    );
    let discard = from
        .delete(
            &format!("/email/drafts/{id}?draft_generation={committed}"),
            None,
        )
        .await?;
    assert_eq!(
        discard.status, 409,
        "a discard removed a message committed for delivery: {}",
        discard.text
    );
    let message = stored(&from, &thread, &id).await?;
    assert_eq!(message["body_text"], "Version two.", "{message}");
    assert_eq!(scheduled(&from).await?.len(), 1);

    come_due(&stack, &from, &id).await?;

    let (_, received) = wait_for_wire(&stack, &to, "Minutes").await?;
    assert!(
        received.html.contains("Version two."),
        "the recipient did not get the committed content: {}",
        received.html
    );
    assert!(
        !received.html.contains("Version one.") && !received.html.contains("Version three."),
        "the recipient got content that was not committed: {}",
        received.html
    );
    let attachment = received
        .attachments
        .iter()
        .find(|attachment| attachment.filename == "minutes.txt");
    assert_eq!(
        attachment.map(|attachment| attachment.bytes.as_slice()),
        Some(b"Agreed: ship it.".as_slice()),
        "the attachment did not go out with the message: {:?}",
        received.attachments
    );

    from.wait_for_preview("sent", "Minutes").await?;
    flush(&stack, &from, &to, "Marker after the minutes").await?;
    assert_eq!(
        provider_copies(&to, "Minutes")?.len(),
        1,
        "the scheduled message was delivered more than once"
    );
    assert!(
        scheduled(&from).await?.is_empty(),
        "a delivered message is still listed as scheduled"
    );

    stack.finish().await
}

/// Undo of a reply sent from a second, non-primary inbox gives back one
/// editable draft in that inbox, with its attachment, and nothing reaches
/// the recipient. The undo is addressed to the inbox the message was sent
/// from, and pressing Undo twice (or retrying after a lost answer) succeeds
/// again. Failing means Undo reports a failure for an undo that worked,
/// loses the draft, or the mail goes out anyway.
async fn undo_send_gives_the_draft_back(provider: Provider) -> Result<(), Report> {
    let stack = stack_with_open_undo_window().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let primary = ada.link(provider, ada.email()).await?;
    let second_address = format!("second.{}", ada.email());
    let second = ada.link(provider, &second_address).await?;
    let to = grace.link(provider, grace.email()).await?;

    second.deliver(&Mail::new(
        &format!("Grace <{}>", grace.email()),
        "Status",
        "Is it ready?",
    ))?;
    let preview = second.wait_for_preview("inbox", "Status").await?;
    let original = first_message(&second, &preview).await?;

    let draft = second
        .save_draft(&json!({
            "subject": "Re: Status",
            "to": [{ "email": grace.email() }],
            "replying_to_id": original["db_id"],
            "body_text": "hello",
            "body_html": html("<html><body><div>hello</div></body></html>"),
        }))
        .await?;
    let id = text(&draft, "db_id")?.to_owned();
    let thread = text(&draft, "thread_db_id")?.to_owned();
    let current = generation(&second, &thread, &id).await?;
    second
        .attach_to_draft(&id, current, "status.txt", b"Ready.")
        .await?;

    // Send: the composer appends the quoted thread to what it sends.
    let current = generation(&second, &thread, &id).await?;
    let sent = second
        .send(&json!({
            "db_id": id,
            "draft_generation": current,
            "subject": "Re: Status",
            "to": [{ "email": grace.email() }],
            "replying_to_id": original["db_id"],
            "body_text": "hello",
            "body_html": html(
                "<html><body><div>hello</div>\
                 <div class=\"macro_quote\"><blockquote>Is it ready?</blockquote></div>\
                 </body></html>"
            ),
        }))
        .await?;
    assert_eq!(sent["db_id"], id.as_str(), "the send made a second message");
    let queued = stored(&second, &thread, &id).await?;
    assert_eq!(queued["is_draft"], false, "{queued}");
    let current = generation(&second, &thread, &id).await?;

    // The undo names the inbox the message was sent from. Addressed to the
    // primary inbox it finds nothing, and must not touch the message.
    let wrong_inbox = cancel(&primary, &id, current).await?;
    assert!(
        (400..500).contains(&wrong_inbox.status),
        "an undo addressed to another inbox answered {}: {}",
        wrong_inbox.status,
        wrong_inbox.text
    );
    let undone = cancel(&second, &id, current).await?;
    assert_eq!(undone.status, 204, "the undo failed: {}", undone.text);
    let current = generation(&second, &thread, &id).await?;
    let again = cancel(&second, &id, current).await?;
    assert_eq!(
        again.status, 204,
        "a second undo of an undone send failed: {}",
        again.text
    );

    let restored = stored(&second, &thread, &id).await?;
    assert_eq!(restored["is_draft"], true, "{restored}");
    assert_eq!(restored["is_sent"], false, "{restored}");
    assert_eq!(restored["link_id"], second.link_id().to_string().as_str());
    let files: Vec<&str> = restored["attachments_draft"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|attachment| attachment["file_name"].as_str())
        .collect();
    assert_eq!(files, ["status.txt"], "the undo lost the attachment");
    let read = second.thread(&thread).await?;
    let drafts = read["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|message| message["is_draft"] == true)
        .count();
    assert_eq!(drafts, 1, "the undo left {drafts} drafts in the thread");
    assert!(scheduled(&second).await?.is_empty());

    // The composer puts back what the user had typed; the draft takes it.
    let current = generation(&second, &thread, &id).await?;
    second
        .save_draft(&json!({
            "db_id": id,
            "draft_generation": current,
            "subject": "Re: Status",
            "to": [{ "email": grace.email() }],
            "replying_to_id": original["db_id"],
            "body_text": "hello",
            "body_html": html("<html><body><div>hello</div></body></html>"),
        }))
        .await?;
    let restored = stored(&second, &thread, &id).await?;
    assert_eq!(restored["body_text"], "hello");
    assert!(
        !restored["body_html_sanitized"]
            .as_str()
            .unwrap_or_default()
            .contains("macro_quote"),
        "the restored draft still holds the quoted thread: {restored}"
    );

    // The delivery that was queued for the send finds nothing to deliver.
    sweep(&stack, &second, &id).await?;
    flush(&stack, &second, &to, "Marker after the undo").await?;
    assert!(
        provider_copies(&to, "Re: Status")?.is_empty(),
        "an undone send reached the recipient"
    );

    stack.finish().await
}

/// A new message sent without ever being saved as a draft and undone within
/// the window is not delivered, and is a draft the sender can still open.
/// Failing means Undo is too late by design: the mail has left, or the
/// message is gone.
async fn undo_within_the_window_delivers_nothing(provider: Provider) -> Result<(), Report> {
    let stack = stack_with_open_undo_window().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    let sent = from
        .send(&json!({
            "subject": "Sent too soon",
            "to": [{ "email": grace.email() }],
            "body_text": "Not finished",
        }))
        .await?;
    let id = text(&sent, "db_id")?.to_owned();
    let thread = text(&sent, "thread_db_id")?.to_owned();
    let queued = stored(&from, &thread, &id).await?;
    assert_eq!(queued["is_draft"], false, "{queued}");
    assert_eq!(queued["is_sent"], false, "{queued}");

    let current = generation(&from, &thread, &id).await?;
    let undone = cancel(&from, &id, current).await?;
    assert_eq!(undone.status, 204, "the undo failed: {}", undone.text);

    let message = stored(&from, &thread, &id).await?;
    assert_eq!(message["is_draft"], true, "{message}");
    assert_eq!(message["body_text"], "Not finished");
    assert!(scheduled(&from).await?.is_empty());

    sweep(&stack, &from, &id).await?;
    flush(&stack, &from, &to, "Marker after sending too soon").await?;
    assert!(
        provider_copies(&to, "Sent too soon")?.is_empty(),
        "an undone send reached the recipient"
    );

    stack.finish().await
}

/// A delivery request for a message that no longer exists is dropped, and
/// the scheduled message behind it in the queue still goes out. Failing
/// means one bad entry stops the delivery worker (`finish` reports a panic)
/// and later scheduled mail waits.
async fn a_missing_message_does_not_hold_up_the_next(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    let draft = from
        .save_draft(&json!({
            "subject": "Second in line",
            "to": [{ "email": grace.email() }],
            "body_text": "Still delivered.",
        }))
        .await?;
    let id = text(&draft, "db_id")?.to_owned();
    let thread = text(&draft, "thread_db_id")?.to_owned();
    let current = generation(&from, &thread, &id).await?;
    schedule(&from, &id, current, LATER).await?.ok()?;

    sweep(&stack, &from, &Uuid::now_v7().to_string()).await?;
    come_due(&stack, &from, &id).await?;

    wait_for_wire(&stack, &to, "Second in line").await?;
    assert_eq!(stack.dead_letters(SCHEDULED_QUEUE).await?, 0);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_scheduled_message_waits_for_its_time() -> Result<(), Report> {
    scheduled_message_waits_for_its_time(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_scheduled_message_waits_for_its_time() -> Result<(), Report> {
    scheduled_message_waits_for_its_time(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_scheduled_message_goes_out_as_committed() -> Result<(), Report> {
    scheduled_message_goes_out_as_committed(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_scheduled_message_goes_out_as_committed() -> Result<(), Report> {
    scheduled_message_goes_out_as_committed(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_undo_send_gives_the_draft_back() -> Result<(), Report> {
    undo_send_gives_the_draft_back(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_undo_send_gives_the_draft_back() -> Result<(), Report> {
    undo_send_gives_the_draft_back(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_undo_within_the_window_delivers_nothing() -> Result<(), Report> {
    undo_within_the_window_delivers_nothing(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_undo_within_the_window_delivers_nothing() -> Result<(), Report> {
    undo_within_the_window_delivers_nothing(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_missing_message_does_not_hold_up_the_next() -> Result<(), Report> {
    a_missing_message_does_not_hold_up_the_next(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_missing_message_does_not_hold_up_the_next() -> Result<(), Report> {
    a_missing_message_does_not_hold_up_the_next(Provider::Outlook).await
}
