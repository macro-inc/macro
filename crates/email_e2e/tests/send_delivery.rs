//! Delivery of a message sent from Macro: it leaves through the provider
//! once, arrives as it was written, and its sender can see what became of it.

#![expect(
    clippy::disallowed_methods,
    reason = "a scenario reads and changes its own database, which the query cache does not describe"
)]

#[path = "send_support/support.rs"]
mod support;

use email_e2e::gmail_emulator::{
    Fault as GmailFault, FaultError as GmailFaultError, Route as GmailRoute,
};
use email_e2e::outlook_emulator::{
    Fault as OutlookFault, FaultError as OutlookFaultError, Route as OutlookRoute,
};
use email_e2e::{DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, eventually};
use rootcause::prelude::*;
use serde_json::{Value, json};
use support::{
    first_message, html, is_draft_at_provider, message_in_thread, provider_copies, wait_for_wire,
};
use uuid::Uuid;

/// The queue a due send waits on.
const SCHEDULED_QUEUE: &str = "scheduled";
/// The status of a request the provider refused for naming no body length.
const LENGTH_REQUIRED: u16 = 411;
/// How long Gmail holds its answer to a send it has already accepted: long
/// enough for the scenario to stop the workers while they wait for it.
const HELD_ANSWER_MS: u64 = 30_000;
/// The most characters of a subject Exchange keeps.
const OUTLOOK_SUBJECT_LIMIT: usize = 255;
/// Whether an Outlook folder, by display or well-known name, is Sent Items.
fn in_sent_items(folder: &str) -> bool {
    folder.eq_ignore_ascii_case("Sent Items") || folder.eq_ignore_ascii_case("sentitems")
}

/// A field of a JSON object that must be a string.
fn text<'a>(value: &'a Value, field: &str) -> Result<&'a str, Report> {
    match value[field].as_str() {
        Some(text) => Ok(text),
        None => bail!("no {field} in {value}"),
    }
}

/// The message a send or a save answered, as the queue names it.
fn queue_message(inbox: &Inbox, sent: &Value) -> Result<Value, Report> {
    Ok(json!({ "link_id": inbox.link_id(), "message_id": text(sent, "db_id")? }))
}

/// The sent message as its sender's thread shows it, or null while the
/// thread does not list it.
async fn in_senders_thread(inbox: &Inbox, sent: &Value) -> Result<Value, Report> {
    message_in_thread(inbox, text(sent, "thread_db_id")?, text(sent, "db_id")?).await
}

/// Waits until Macro shows the message as sent.
async fn wait_until_sent(inbox: &Inbox, sent: &Value) -> Result<Value, Report> {
    eventually(
        "Macro to show the message as sent",
        DEFAULT_TIMEOUT,
        async || {
            let message = in_senders_thread(inbox, sent).await?;
            Ok((message["is_sent"] == true).then_some(message))
        },
    )
    .await
}

/// The state of the message's provider operation
/// (`GET /email/drafts/{id}/operation`), or null when it has none.
async fn operation(inbox: &Inbox, sent: &Value) -> Result<Value, Report> {
    let read = inbox
        .get(&format!("/email/drafts/{}/operation", text(sent, "db_id")?))
        .await?
        .ok()?;
    Ok(read["operation"].clone())
}

/// Puts a message from `from` in `inbox` at the provider, waits for Macro to
/// show it, and returns it as the thread view does: what a reply names.
async fn received(inbox: &Inbox, from: &str, subject: &str, body: &str) -> Result<Value, Report> {
    inbox.deliver(&Mail {
        html: Some(format!("<div>{body}</div>")),
        ..Mail::new(&format!("Grace <{from}>"), subject, body)
    })?;
    let preview = inbox.wait_for_preview("inbox", subject).await?;
    first_message(inbox, &preview).await
}

/// Sends a saved draft while the queue refuses the send's message: the state
/// a send is left in when the API committed it and the queue write was lost.
/// The API may answer the send with an error; the draft names the message.
async fn send_and_lose_the_queue_message(
    stack: &Stack,
    from: &Inbox,
    message: &Value,
) -> Result<Value, Report> {
    let draft = from.save_draft(message).await?;
    let mut send = message.clone();
    send["db_id"] = draft["db_id"].clone();
    send["draft_generation"] = draft["draft_generation"].clone();
    stack.refuse_queue_sends(SCHEDULED_QUEUE, 1)?;
    from.post("/email/messages", Some(&json!({ "message": send })))
        .await?;
    Ok(draft)
}

/// A reply sent from Macro joins the conversation on both sides: the
/// recipient sees it under the message it answers, not as a new thread, and
/// so does the sender. If this fails, a reply starts a conversation of
/// its own for one of them.
async fn reply_joins_the_thread_on_both_sides(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let ada_inbox = ada.link(provider, ada.email()).await?;
    let grace_inbox = grace.link(provider, grace.email()).await?;

    grace_inbox
        .send(&json!({
            "subject": "Status",
            "to": [{ "email": ada.email() }],
            "body_text": "Is it ready?",
            "body_html": html("<html><body><div>Is it ready?</div></body></html>"),
        }))
        .await?;
    let asked = grace_inbox.wait_for_preview("sent", "Status").await?;
    let arrived = ada_inbox.wait_for_preview("inbox", "Status").await?;
    let original = first_message(&ada_inbox, &arrived).await?;

    ada_inbox
        .send(&json!({
            "subject": "Re: Status",
            "to": [{ "email": grace.email() }],
            "replying_to_id": original["db_id"],
            "body_text": "It is.",
            "body_html": html("<html><body><div>It is.</div></body></html>"),
        }))
        .await?;

    let two_messages = |thread: &Value| {
        thread["messages"]
            .as_array()
            .is_some_and(|messages| messages.iter().filter(|m| m["is_draft"] != true).count() == 2)
    };
    let at_grace = grace_inbox
        .wait_for_thread(
            text(&asked, "id")?,
            "the reply to join the thread it answers at the recipient",
            two_messages,
        )
        .await?;
    assert!(
        at_grace["messages"]
            .as_array()
            .is_some_and(|messages| messages.iter().any(|m| m["body_text"] == "It is.")),
        "{at_grace}"
    );
    ada_inbox
        .wait_for_thread(
            text(&arrived, "id")?,
            "the reply to join the thread it answers at the sender",
            two_messages,
        )
        .await?;

    let question = provider_copies(&grace_inbox, "Status")?;
    let answer = provider_copies(&grace_inbox, "Re: Status")?;
    assert_eq!(answer.len(), 1, "{answer:?}");
    assert!(
        question
            .iter()
            .any(|message| message.thread_id == answer[0].thread_id),
        "the provider filed the reply apart from the message it answers: {question:?} {answer:?}"
    );

    stack.finish().await
}

/// Everyone a message names gets it, and nobody learns who was on Bcc: the
/// Bcc recipient's address is in no header and no body of the other copies.
async fn cc_and_bcc_recipients_get_the_message(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let linus = stack.user("linus").await?;
    let joan = stack.user("joan").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;
    let cc = linus.link(provider, linus.email()).await?;
    let bcc = joan.link(provider, joan.email()).await?;

    from.send(&json!({
        "subject": "Launch plan",
        "to": [{ "email": grace.email(), "name": "Grace" }],
        "cc": [{ "email": linus.email(), "name": "Linus" }],
        "bcc": [{ "email": joan.email(), "name": "Joan" }],
        "body_text": "Friday.",
        "body_html": html("<html><body><div>Friday.</div></body></html>"),
    }))
    .await?;

    let (_, to_copy) = wait_for_wire(&stack, &to, "Launch plan").await?;
    let (_, cc_copy) = wait_for_wire(&stack, &cc, "Launch plan").await?;
    let (_, bcc_copy) = wait_for_wire(&stack, &bcc, "Launch plan").await?;
    assert!(bcc_copy.html.contains("Friday."), "{}", bcc_copy.html);
    for copy in [&to_copy, &cc_copy] {
        assert!(
            !copy
                .headers
                .iter()
                .any(|(_, value)| value.contains(joan.email())),
            "a copy names the Bcc recipient in its headers: {:?}",
            copy.headers
        );
        assert!(!copy.html.contains(joan.email()), "{}", copy.html);
    }
    assert!(
        to_copy
            .header("cc")
            .is_some_and(|value| value.contains(linus.email())),
        "the Cc recipient is not named on the To recipient's copy: {:?}",
        to_copy.headers
    );
    for inbox in [&to, &cc, &bcc] {
        assert_eq!(provider_copies(inbox, "Launch plan")?.len(), 1);
    }

    stack.finish().await
}

/// An Outlook send and an Outlook reply both leave: Graph refuses a `POST`
/// without a body unless it names a length of 0, and `send` and
/// `createReply` are such requests. When this fails every Outlook send ends
/// as a permanent failure.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_bodyless_requests_name_their_length() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link_outlook().await?;
    let to = grace.link_outlook().await?;
    let original = received(&from, grace.email(), "Budget", "Can you check it?").await?;

    let new = from
        .send(&json!({
            "subject": "Offsite",
            "to": [{ "email": grace.email() }],
            "body_text": "June works.",
            "body_html": html("<html><body><div>June works.</div></body></html>"),
        }))
        .await?;
    let reply = from
        .send(&json!({
            "subject": "Re: Budget",
            "to": [{ "email": grace.email() }],
            "replying_to_id": original["db_id"],
            "body_text": "Checked.",
            "body_html": html("<html><body><div>Checked.</div></body></html>"),
        }))
        .await?;

    let (new_at_grace, _) = wait_for_wire(&stack, &to, "Offsite").await?;
    assert!(new_at_grace.in_inbox);
    let (_, reply_at_grace) = wait_for_wire(&stack, &to, "Re: Budget").await?;
    assert!(
        reply_at_grace.html.contains("Checked."),
        "{}",
        reply_at_grace.html
    );
    wait_until_sent(&from, &new).await?;
    wait_until_sent(&from, &reply).await?;
    for subject in ["Offsite", "Re: Budget"] {
        let kept = provider_copies(&from, subject)?;
        assert!(
            kept.len() == 1 && kept[0].labels.iter().any(|folder| in_sent_items(folder)),
            "{subject:?} is not in Sent Items once: {kept:?}"
        );
    }

    let refused: Vec<_> = stack
        .outlook()
        .requests()
        .into_iter()
        .filter(|request| request.status == LENGTH_REQUIRED)
        .collect();
    assert!(
        refused.is_empty(),
        "Graph refused requests that named no body length: {refused:?}"
    );

    stack.finish().await
}

/// A message sent from an Outlook inbox is in Sent as soon as Outlook has
/// it, with a date, without waiting for the mailbox's next sync to bring the
/// Sent Items copy back. When this fails the sender looks in Sent, finds
/// nothing, and is told the send may have failed.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_send_is_in_sent_before_the_mailbox_syncs() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link_outlook().await?;
    let to = grace.link_outlook().await?;

    // From here on the sender's mailbox cannot be read for changes: what
    // Macro shows of the send is what it knows from sending it.
    stack.outlook().inject_fault(OutlookFault {
        mailbox: Some(ada.email().to_owned()),
        route: Some(OutlookRoute::MessagesDelta),
        error: Some(OutlookFaultError::Internal),
        ..OutlookFault::default()
    });
    stack.outlook().clear_requests();

    let sent = from
        .send(&json!({
            "subject": "Minutes",
            "to": [{ "email": grace.email() }],
            "body_text": "Attached soon.",
            "body_html": html("<html><body><div>Attached soon.</div></body></html>"),
        }))
        .await?;
    wait_for_wire(&stack, &to, "Minutes").await?;

    from.wait_for_preview("sent", "Minutes").await?;
    let message = in_senders_thread(&from, &sent).await?;
    assert_eq!(message["is_sent"], true, "{message}");
    assert!(
        message["internal_date_ts"].is_string(),
        "the sent message has no date: {message}"
    );

    let synced: Vec<_> = stack
        .outlook()
        .requests()
        .into_iter()
        .filter(|request| {
            request.route == Some(OutlookRoute::MessagesDelta)
                && request.mailbox.as_deref() == Some(ada.email())
                && request.status < 400
        })
        .collect();
    assert!(
        synced.is_empty(),
        "the mailbox synced during the scenario, so it proves nothing: {synced:?}"
    );

    stack.finish().await
}

/// Gmail accepted a send, and the worker died before it could record that.
/// However often the sweep brings the message back, it is looked up at
/// Gmail by its `Message-ID` and marked sent: the recipient holds one copy.
/// When this fails every sweep sends the same mail again.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_sweep_does_not_resend_what_gmail_accepted() -> Result<(), Report> {
    let mut stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link_gmail().await?;
    let to = grace.link_gmail().await?;

    // Gmail takes the message and keeps the worker waiting for the answer.
    stack.gmail().inject_fault(GmailFault {
        mailbox: Some(ada.email().to_owned()),
        route: Some(GmailRoute::MessagesSend),
        delay_ms: Some(HELD_ANSWER_MS),
        times: Some(1),
        ..GmailFault::default()
    });
    let sent = from
        .send(&json!({
            "subject": "Invoice 42",
            "to": [{ "email": grace.email() }],
            "body_text": "Please pay.",
        }))
        .await?;
    to.wait_for_provider_message("the message Gmail accepted", |message| {
        message.subject == "Invoice 42"
    })
    .await?;
    stack.stop_workers().await;
    stack.gmail().clear_faults();

    // Five minutes later the dead worker's lease has run out. Nothing can
    // move the services' clock, so the scenario ends the lease itself.
    let message_id: Uuid = text(&sent, "db_id")?.parse()?;
    let expired = sqlx::query(
        "UPDATE email_scheduled_messages
         SET delivery_lease_expires_at = now() - interval '1 second'
         WHERE message_id = $1 AND NOT sent AND delivery_started_at IS NOT NULL",
    )
    .bind(message_id)
    .execute(stack.db())
    .await?;
    assert_eq!(
        expired.rows_affected(),
        1,
        "the send was not left between submission and completion"
    );

    stack.start_workers()?;
    let queued = queue_message(&from, &sent)?;
    for _ in 0..3 {
        stack.send_to_queue(SCHEDULED_QUEUE, &queued).await?;
    }

    wait_until_sent(&from, &sent).await?;
    from.wait_for_preview("sent", "Invoice 42").await?;
    // Every sweep message, and the one the stopped worker held, is worked off
    // before the copies are counted.
    eventually("the queue to be worked off", DEFAULT_TIMEOUT, async || {
        Ok((stack.queue_depth(SCHEDULED_QUEUE).await? == 0).then_some(()))
    })
    .await?;
    let delivered = provider_copies(&to, "Invoice 42")?;
    assert_eq!(
        delivered.len(),
        1,
        "the recipient holds the same mail more than once: {delivered:?}"
    );
    let kept = provider_copies(&from, "Invoice 42")?;
    assert_eq!(kept.len(), 1, "the sender's mailbox: {kept:?}");

    stack.finish().await
}

/// The provider refuses a send for good. The message is not delivered, and
/// its sender can read that it failed instead of being left with a message
/// that looks sent. When this fails a refused send is silent.
async fn refused_send_is_reported_as_failed(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;
    match provider {
        Provider::Gmail => stack.gmail().inject_fault(GmailFault {
            mailbox: Some(ada.email().to_owned()),
            route: Some(GmailRoute::MessagesSend),
            error: Some(GmailFaultError::Forbidden),
            ..GmailFault::default()
        }),
        Provider::Outlook => stack.outlook().inject_fault(OutlookFault {
            mailbox: Some(ada.email().to_owned()),
            route: Some(OutlookRoute::MessagesSend),
            error: Some(OutlookFaultError::Forbidden),
            ..OutlookFault::default()
        }),
    };

    let sent = from
        .send(&json!({
            "subject": "Refused",
            "to": [{ "email": grace.email() }],
            "body_text": "This will not leave.",
            "body_html": html("<html><body><div>This will not leave.</div></body></html>"),
        }))
        .await?;

    let state = eventually(
        "the refused send to be reported as failed",
        DEFAULT_TIMEOUT,
        async || {
            let message = in_senders_thread(&from, &sent).await?;
            let operation = operation(&from, &sent).await?;
            let failed =
                message["scheduled_send_status"] == "failed" || operation["state"] == "FAILED";
            Ok(failed.then(|| json!({ "message": message, "operation": operation })))
        },
    )
    .await?;
    assert_ne!(state["message"]["is_sent"], true, "{state}");
    if provider == Provider::Outlook {
        assert_eq!(state["operation"]["issue"], "SEND_REJECTED", "{state}");
    }

    // A later message goes through, and the refused one is still nowhere.
    match provider {
        Provider::Gmail => stack.gmail().clear_faults(),
        Provider::Outlook => stack.outlook().clear_faults(),
    }
    from.send(&json!({
        "subject": "Accepted",
        "to": [{ "email": grace.email() }],
        "body_text": "This one leaves.",
    }))
    .await?;
    wait_for_wire(&stack, &to, "Accepted").await?;
    let delivered = provider_copies(&to, "Refused")?;
    assert!(
        delivered.is_empty(),
        "a refused send was delivered: {delivered:?}"
    );
    assert!(
        from.previews("sent")
            .await?
            .iter()
            .all(|preview| preview["name"] != "Refused"),
        "a refused send is listed in Sent"
    );

    stack.finish().await
}

/// A reply whose body already carries the conversation, quoted by another
/// mail client, goes out with that quote once: the server adds no second
/// copy of the thread, and the provider's own reply draft does not bring one
/// either. If this fails, the recipient reads the conversation twice
/// under the reply.
async fn quoted_thread_is_sent_once(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;
    let original = received(&from, grace.email(), "Venue", "Is the hall booked?").await?;

    // What Gmail and Outlook write around the conversation under a reply.
    let quote = match provider {
        Provider::Gmail => concat!(
            r#"<div class="gmail_quote"><div class="gmail_attr">Grace wrote:</div>"#,
            r#"<blockquote class="gmail_quote">Is the hall booked?</blockquote></div>"#,
        ),
        Provider::Outlook => concat!(
            r#"<hr><div id="divRplyFwdMsg"><b>From:</b> Grace</div>"#,
            r#"<div>Is the hall booked?</div>"#,
        ),
    };
    from.send(&json!({
        "subject": "Re: Venue",
        "to": [{ "email": grace.email() }],
        "replying_to_id": original["db_id"],
        "body_text": "Yes, since Monday.",
        "body_html": html(&format!(
            "<html><body><div>Yes, since Monday.</div>{quote}</body></html>"
        )),
    }))
    .await?;

    let (_, reply) = wait_for_wire(&stack, &to, "Re: Venue").await?;
    assert_eq!(
        reply.html_count("Yes, since Monday."),
        1,
        "the reply's own text: {}",
        reply.html
    );
    assert_eq!(
        reply.html_count("Is the hall booked?"),
        1,
        "the quoted conversation is not there exactly once: {}",
        reply.html
    );

    stack.finish().await
}

/// The recipient gets the HTML the composer handed over: paragraphs stay
/// paragraphs, in order, and a link stays a link to the same address. When
/// this fails recipients see text run together or a link that does nothing.
async fn sent_html_keeps_paragraphs_and_links(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    let body = concat!(
        "<html><body>",
        "<p>First point.</p><p>Second point.</p><p>Third point.</p>",
        r#"<p><a href="https://example.com/book/ada">Book a time</a></p>"#,
        "</body></html>",
    );
    from.send(&json!({
        "subject": "Three points",
        "to": [{ "email": grace.email() }],
        "body_text": "First point.\n\nSecond point.\n\nThird point.\n\nBook a time",
        "body_html": html(body),
    }))
    .await?;

    let (_, received) = wait_for_wire(&stack, &to, "Three points").await?;
    let places: Vec<_> = [
        "<p>First point.</p>",
        "<p>Second point.</p>",
        "<p>Third point.</p>",
        "Book a time</a>",
    ]
    .iter()
    .map(|part| received.html.find(part))
    .collect();
    assert!(
        places.iter().all(Option::is_some) && places.is_sorted(),
        "the paragraphs are not separate and in order: {}",
        received.html
    );
    assert_eq!(
        received.html_count(r#"href="https://example.com/book/ada""#),
        1,
        "the link lost its address: {}",
        received.html
    );

    stack.finish().await
}

/// A reply leaves with the subject the composer gave it, whatever prefix
/// the original carried: the server and the provider's reply draft add no
/// second `Re:`. When this fails replies arrive as `RE: Re: …`.
async fn reply_keeps_the_composers_subject(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    // The original's subject, and what the composer makes of it.
    let subjects = [
        ("RE: Roadmap", "RE: Roadmap"),
        ("re:pricing", "re:pricing"),
        ("AW: Termin", "Re: AW: Termin"),
        ("Hiring", "Re: Hiring"),
    ];
    for (original, reply) in subjects {
        let message = received(&from, grace.email(), original, "See above.").await?;
        from.send(&json!({
            "subject": reply,
            "to": [{ "email": grace.email() }],
            "replying_to_id": message["db_id"],
            "body_text": "Agreed.",
            "body_html": html("<html><body><div>Agreed.</div></body></html>"),
        }))
        .await?;
    }

    for (_, reply) in subjects {
        wait_for_wire(&stack, &to, reply).await?;
    }
    let mut arrived: Vec<_> = to
        .provider_messages()?
        .into_iter()
        .map(|message| message.subject)
        .collect();
    arrived.sort();
    let mut expected: Vec<_> = subjects
        .iter()
        .map(|(_, reply)| reply.to_string())
        .collect();
    expected.sort();
    assert_eq!(arrived, expected);

    stack.finish().await
}

/// The API committed a Gmail send and the queue never got its message. The
/// sweep finds the send and it is delivered, once. When this fails the
/// composer said "sent" and the message never leaves.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: send-stranded-when-enqueue-fails"]
async fn gmail_send_survives_a_lost_queue_message() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link_gmail().await?;
    let to = grace.link_gmail().await?;

    let sent = send_and_lose_the_queue_message(
        &stack,
        &from,
        &json!({
            "subject": "Contract",
            "to": [{ "email": grace.email() }],
            "body_text": "Signed.",
        }),
    )
    .await?;

    // The sweep runs every minute in production; here, until the mail is out.
    eventually(
        "the sweep to bring the stranded send out",
        DEFAULT_TIMEOUT,
        async || {
            stack.run_scheduled_sweep().await?;
            Ok(provider_copies(&to, "Contract")?.into_iter().next())
        },
    )
    .await?;
    wait_until_sent(&from, &sent).await?;
    eventually("the queue to be worked off", DEFAULT_TIMEOUT, async || {
        Ok((stack.queue_depth(SCHEDULED_QUEUE).await? == 0).then_some(()))
    })
    .await?;
    let delivered = provider_copies(&to, "Contract")?;
    assert_eq!(delivered.len(), 1, "{delivered:?}");
    stack.run_scheduled_sweep().await?;
    eventually("the queue to be worked off", DEFAULT_TIMEOUT, async || {
        Ok((stack.queue_depth(SCHEDULED_QUEUE).await? == 0).then_some(()))
    })
    .await?;
    let delivered = provider_copies(&to, "Contract")?;
    assert_eq!(
        delivered.len(),
        1,
        "a sent message was swept again: {delivered:?}"
    );

    stack.finish().await
}

/// The API committed an Outlook send and the queue never got its message.
/// The mailbox's own delivery loop finds the due send without the queue, and
/// it is delivered once. When this fails the message never leaves.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_send_survives_a_lost_queue_message() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link_outlook().await?;
    let to = grace.link_outlook().await?;

    let sent = send_and_lose_the_queue_message(
        &stack,
        &from,
        &json!({
            "subject": "Contract",
            "to": [{ "email": grace.email() }],
            "body_text": "Signed.",
            "body_html": html("<html><body><div>Signed.</div></body></html>"),
        }),
    )
    .await?;

    wait_for_wire(&stack, &to, "Contract").await?;
    wait_until_sent(&from, &sent).await?;
    // Late queue messages for a send that is out change nothing.
    let queued = queue_message(&from, &sent)?;
    stack.send_to_queue(SCHEDULED_QUEUE, &queued).await?;
    eventually("the queue to be worked off", DEFAULT_TIMEOUT, async || {
        Ok((stack.queue_depth(SCHEDULED_QUEUE).await? == 0).then_some(()))
    })
    .await?;
    let delivered = provider_copies(&to, "Contract")?;
    assert_eq!(delivered.len(), 1, "{delivered:?}");

    stack.finish().await
}

/// Exchange keeps 255 characters of a subject. A draft with a longer one
/// still saves, saves again and sends from an Outlook inbox: the shortened
/// subject Outlook answers is not taken for someone else's edit. When this
/// fails the draft ends in a sync conflict and cannot be sent.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_subject_over_the_limit_still_sends() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link_outlook().await?;
    let to = grace.link_outlook().await?;
    let long = format!("Agenda {}", "and more ".repeat(40));
    assert!(long.chars().count() > OUTLOOK_SUBJECT_LIMIT);
    let kept: String = long.chars().take(OUTLOOK_SUBJECT_LIMIT).collect();

    let draft = from
        .save_draft(&json!({
            "subject": long,
            "to": [{ "email": grace.email() }],
            "body_text": "First version.",
            "body_html": html("<html><body><div>First version.</div></body></html>"),
        }))
        .await?;
    from.wait_for_provider_message("the draft at Outlook", |message| {
        message.subject == kept && is_draft_at_provider(message)
    })
    .await?;
    let edited = from
        .save_draft(&json!({
            "db_id": draft["db_id"],
            "draft_generation": draft["draft_generation"],
            "subject": long,
            "to": [{ "email": grace.email() }],
            "body_text": "Second version.",
            "body_html": html("<html><body><div>Second version.</div></body></html>"),
        }))
        .await?;
    let sent = from
        .send(&json!({
            "db_id": edited["db_id"],
            "draft_generation": edited["draft_generation"],
            "subject": long,
            "to": [{ "email": grace.email() }],
            "body_text": "Second version.",
            "body_html": html("<html><body><div>Second version.</div></body></html>"),
        }))
        .await?;

    let (_, received) = wait_for_wire(&stack, &to, &kept).await?;
    assert!(
        received.html.contains("Second version."),
        "{}",
        received.html
    );
    wait_until_sent(&from, &sent).await?;
    let state = operation(&from, &sent).await?;
    assert!(
        state["state"] != "CONFLICT" && state["state"] != "FAILED",
        "the draft ended in {state}"
    );
    assert_eq!(provider_copies(&to, &kept)?.len(), 1);
    let at_sender = provider_copies(&from, &kept)?;
    assert!(
        at_sender.len() == 1
            && at_sender[0]
                .labels
                .iter()
                .any(|folder| in_sent_items(folder)),
        "the sender's mailbox: {at_sender:?}"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_reply_joins_the_thread_on_both_sides() -> Result<(), Report> {
    reply_joins_the_thread_on_both_sides(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_reply_joins_the_thread_on_both_sides() -> Result<(), Report> {
    reply_joins_the_thread_on_both_sides(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_cc_and_bcc_recipients_get_the_message() -> Result<(), Report> {
    cc_and_bcc_recipients_get_the_message(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_cc_and_bcc_recipients_get_the_message() -> Result<(), Report> {
    cc_and_bcc_recipients_get_the_message(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_refused_send_is_reported_as_failed() -> Result<(), Report> {
    refused_send_is_reported_as_failed(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_refused_send_is_reported_as_failed() -> Result<(), Report> {
    refused_send_is_reported_as_failed(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_quoted_thread_is_sent_once() -> Result<(), Report> {
    quoted_thread_is_sent_once(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_quoted_thread_is_sent_once() -> Result<(), Report> {
    quoted_thread_is_sent_once(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_sent_html_keeps_paragraphs_and_links() -> Result<(), Report> {
    sent_html_keeps_paragraphs_and_links(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_sent_html_keeps_paragraphs_and_links() -> Result<(), Report> {
    sent_html_keeps_paragraphs_and_links(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_reply_keeps_the_composers_subject() -> Result<(), Report> {
    reply_keeps_the_composers_subject(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_reply_keeps_the_composers_subject() -> Result<(), Report> {
    reply_keeps_the_composers_subject(Provider::Outlook).await
}
