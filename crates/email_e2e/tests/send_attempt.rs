//! Sending the way the web composer does: the GraphQL send-attempt path.

use email_e2e::{
    DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, StackOptions, eventually,
    gmail_emulator, outlook_emulator,
};
use serde_json::{Value, json};
use uuid::Uuid;

/// What the user wrote, before Send added the quoted mail below it.
const WRITTEN: &str = "hello";
/// The undo window of a scenario that undoes, in seconds.
const UNDO_WINDOW_SECS: &str = "5";
/// The undo window of an Outlook send that must still be waiting when its
/// draft has settled in the mailbox, in seconds.
const OUTLOOK_SETTLING_WINDOW_SECS: &str = "20";

/// A stack that also serves the GraphQL API.
async fn stack_with_graphql() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await
}

/// The composer's message input for a new mail to `to`.
fn message(subject: &str, to: &str, body: &str) -> Value {
    json!({
        "draftId": Uuid::now_v7(),
        "subject": subject,
        "to": [{ "email": to }],
        "bodyText": body,
    })
}

/// A Send from the composer is accepted, leaves through the provider once
/// its undo window closes, and reports itself sent; pressing Send again for
/// the same attempt sends nothing more.
async fn composer_send_reaches_the_other_mailbox(provider: Provider) -> Result<(), Report> {
    let stack = stack_with_graphql().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    let attempt_id = Uuid::now_v7();
    let mail = message("Quarterly numbers", grace.email(), "They are in.");
    let accepted = from.send_attempt(attempt_id, &mail, &json!({})).await?;
    assert_eq!(accepted["status"], "ACCEPTED", "{accepted}");
    assert!(accepted["sendTime"].is_string(), "{accepted}");

    let received = to.wait_for_preview("inbox", "Quarterly numbers").await?;
    assert_eq!(received["senderEmail"], ada.email());
    let sent = from.wait_for_send_attempt(attempt_id, "SENT").await?;
    assert_eq!(sent["message"]["isSent"], true, "{sent}");
    assert_eq!(sent["message"]["isDraft"], false, "{sent}");
    from.wait_for_preview("sent", "Quarterly numbers").await?;

    let replayed = from.send_attempt(attempt_id, &mail, &json!({})).await?;
    assert_eq!(replayed["status"], "SENT", "{replayed}");
    assert_eq!(replayed["message"]["id"], sent["message"]["id"]);
    deliver_marker(&from, &to).await?;
    assert_eq!(to.previews("inbox").await?.len(), 2);
    // A second copy would join the first one's thread: count messages too.
    assert_eq!(to.provider_messages()?.len(), 2);

    stack.finish().await
}

/// Undo within the window gives the composer its draft back as it was
/// before Send: the body without what Send added to it, the attachment, a
/// newer generation, still one draft, and nothing reaches the recipient.
/// When this fails the user gets back a draft that is not the one they
/// wrote, or the mail goes out although they took it back.
async fn undo_restores_the_draft_as_written(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start_with(StackOptions {
        document_storage: true,
        // Long enough that the undo is inside the window on a busy machine.
        env: vec![(
            "SENT_UNDO_DELAY_SECS".to_owned(),
            UNDO_WINDOW_SECS.to_owned(),
        )],
        ..StackOptions::default()
    })
    .await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let _primary = ada.link(provider, ada.email()).await?;
    let from = ada.link(provider, "ada.second@example.com").await?;
    let to = grace.link(provider, grace.email()).await?;

    // Grace writes first, so that the draft is a reply with a quote to add.
    from.deliver(&Mail::new(
        &format!("Grace <{}>", grace.email()),
        "Plans",
        "Shall we?",
    ))?;
    let plans = from.wait_for_preview("inbox", "Plans").await?;
    let thread_id = plans["id"].as_str().unwrap_or_default();
    let thread = from.thread(thread_id).await?;
    let question = &thread["messages"][0];

    let draft = from
        .save_draft(&json!({
            "subject": "Re: Plans",
            "to": [{ "email": grace.email() }],
            "body_text": WRITTEN,
            "replying_to_id": question["db_id"],
            "thread_db_id": thread_id,
        }))
        .await?;
    let draft_id = draft["db_id"].as_str().unwrap_or_default();
    let generation = draft["draft_generation"].as_i64().unwrap_or_default();
    let attachment = from
        .attach_to_draft(draft_id, generation, "notes.txt", b"the notes")
        .await?;

    let attempt_id = Uuid::now_v7();
    let accepted = from
        .send_attempt(
            attempt_id,
            &json!({
                "draftId": draft_id,
                "draftGeneration": generation,
                "subject": "Re: Plans",
                "to": [{ "email": grace.email() }],
                "bodyText": format!("{WRITTEN}\n\n> Shall we?"),
                "replyingToId": question["db_id"],
                "threadDbId": thread_id,
            }),
            &json!({ "attachmentIds": [attachment], "restoreBodyText": WRITTEN }),
        )
        .await?;
    assert_eq!(accepted["status"], "ACCEPTED", "{accepted}");

    let undone = from.cancel_send(attempt_id).await?;
    assert_eq!(undone["status"], "CANCELLED", "{undone}");
    let restored = &undone["message"];
    assert_eq!(restored["isDraft"], true, "{undone}");
    assert_eq!(restored["bodyText"], WRITTEN, "{undone}");
    assert_eq!(restored["linkId"], json!(from.link_id()), "{undone}");
    assert!(
        restored["draftGeneration"].as_i64() > Some(generation),
        "{undone}"
    );
    assert_eq!(
        restored["attachmentsDraft"]
            .as_array()
            .map(|attachments| attachments.iter().map(|a| a["fileName"].clone()).collect()),
        Some(vec![json!("notes.txt")]),
        "{undone}"
    );
    assert_eq!(from.previews("drafts").await?.len(), 1);

    // A second undo changes nothing.
    let again = from.cancel_send(attempt_id).await?;
    assert_eq!(again["status"], "CANCELLED", "{again}");
    assert_eq!(
        again["message"]["draftGeneration"],
        restored["draftGeneration"]
    );

    // The queue message that would have delivered the mail is handled once
    // the window has passed; from then on the sweep would deliver a send
    // that was still live, and the marker arrives after either.
    eventually(
        "the undone send's queue message to be handled",
        DEFAULT_TIMEOUT,
        async || Ok((stack.queue_depth("scheduled").await? == 0).then_some(())),
    )
    .await?;
    stack.run_scheduled_sweep().await?;
    deliver_marker(&from, &to).await?;
    assert_eq!(to.previews("inbox").await?.len(), 1);
    // A second copy would join the first one's thread: count messages too.
    assert_eq!(to.provider_messages()?.len(), 1);
    assert_eq!(from.previews("drafts").await?.len(), 1);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_undo_restores_the_draft_as_written() -> Result<(), Report> {
    undo_restores_the_draft_as_written(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_undo_restores_the_draft_as_written() -> Result<(), Report> {
    undo_restores_the_draft_as_written(Provider::Outlook).await
}

/// The queue refuses the message that would trigger delivery; the Send is
/// still accepted, and the scheduled sweep delivers it once.
/// An Outlook send is not delivered by a queue message at all: the mailbox's
/// draft worker finds the draft already settled in the mailbox once its send
/// is due, which is what delivers it here too.
/// When this fails a mail the user sent is silently never delivered.
async fn sweep_delivers_a_send_whose_queue_message_was_lost(
    provider: Provider,
) -> Result<(), Report> {
    let stack = match provider {
        Provider::Gmail => stack_with_graphql().await?,
        // Long enough that the draft is settled in the mailbox before its
        // send is due: nothing but its coming due can deliver it then.
        Provider::Outlook => {
            Stack::start_with(StackOptions {
                document_storage: true,
                env: vec![(
                    "SENT_UNDO_DELAY_SECS".to_owned(),
                    OUTLOOK_SETTLING_WINDOW_SECS.to_owned(),
                )],
                ..StackOptions::default()
            })
            .await?
        }
    };
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    stack.refuse_queue_sends("scheduled", 1)?;
    let attempt_id = Uuid::now_v7();
    let mail = message("Minutes", grace.email(), "Attached below.");
    let accepted = from.send_attempt(attempt_id, &mail, &json!({})).await?;
    assert_eq!(accepted["status"], "ACCEPTED", "{accepted}");
    assert_eq!(stack.queue_send_refusals_left("scheduled")?, 0);
    if provider == Provider::Outlook {
        let draft_id = accepted["message"]["id"].as_str().unwrap_or_default();
        eventually(
            "the draft to be settled in the mailbox",
            DEFAULT_TIMEOUT,
            async || {
                let read = from
                    .get(&format!("/email/drafts/{draft_id}/operation"))
                    .await?;
                // The draft is not written the moment its Send is accepted.
                if read.status == 404 {
                    return Ok(None);
                }
                let read = read.ok()?;
                Ok((read["operation"]["state"] == "SYNCHRONIZED").then_some(()))
            },
        )
        .await?;
        let waiting = from.send_attempt_state(attempt_id).await?;
        assert_eq!(
            waiting["status"], "ACCEPTED",
            "the send did not wait for its window: {waiting}"
        );
    }

    eventually(
        "the sweep to deliver the send",
        DEFAULT_TIMEOUT,
        async || {
            stack.run_scheduled_sweep().await?;
            let attempt = from.send_attempt_state(attempt_id).await?;
            Ok((attempt["status"] == "SENT").then_some(()))
        },
    )
    .await?;
    to.wait_for_preview("inbox", "Minutes").await?;

    // Later sweeps do not send it again.
    stack.run_scheduled_sweep().await?;
    deliver_marker(&from, &to).await?;
    assert_eq!(to.previews("inbox").await?.len(), 2);
    // A second copy would join the first one's thread: count messages too.
    assert_eq!(to.provider_messages()?.len(), 2);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_sweep_delivers_a_send_whose_queue_message_was_lost() -> Result<(), Report> {
    sweep_delivers_a_send_whose_queue_message_was_lost(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_sweep_delivers_a_send_whose_queue_message_was_lost() -> Result<(), Report> {
    sweep_delivers_a_send_whose_queue_message_was_lost(Provider::Outlook).await
}

/// Sends a later mail the old way and waits for it: anything the services
/// were still going to deliver to `to` has arrived by then.
async fn deliver_marker(from: &Inbox, to: &Inbox) -> Result<(), Report> {
    from.send(&json!({
        "subject": "Marker",
        "to": [{ "email": to.email() }],
        "body_text": "Later.",
    }))
    .await?;
    to.wait_for_preview("inbox", "Marker").await?;
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_composer_send_reaches_the_other_mailbox() -> Result<(), Report> {
    composer_send_reaches_the_other_mailbox(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_composer_send_reaches_the_other_mailbox() -> Result<(), Report> {
    composer_send_reaches_the_other_mailbox(Provider::Outlook).await
}

/// The provider refuses the submission: the Send reports itself failed
/// instead of sent or still on its way, nothing reaches the recipient, and
/// undoing it gives the draft back.
/// When this fails the user is told a refused mail went out, or cannot get
/// the refused mail back to fix it.
async fn refused_send_fails_and_can_be_taken_back(
    stack: Stack,
    provider: Provider,
) -> Result<(), Report> {
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    match provider {
        Provider::Gmail => stack.gmail().inject_fault(gmail_emulator::Fault {
            mailbox: Some(ada.email().to_owned()),
            route: Some(gmail_emulator::Route::MessagesSend),
            error: Some(gmail_emulator::FaultError::Forbidden),
            times: Some(1),
            ..Default::default()
        }),
        Provider::Outlook => stack.outlook().inject_fault(outlook_emulator::Fault {
            mailbox: Some(ada.email().to_owned()),
            route: Some(outlook_emulator::Route::MessagesSend),
            error: Some(outlook_emulator::FaultError::Forbidden),
            times: Some(1),
            ..Default::default()
        }),
    };

    let attempt_id = Uuid::now_v7();
    let mail = message("Offer", grace.email(), "Final terms.");
    from.send_attempt(attempt_id, &mail, &json!({})).await?;
    let failed = from.wait_for_send_attempt(attempt_id, "FAILED").await?;
    assert_eq!(failed["message"]["isSent"], false, "{failed}");
    match provider {
        Provider::Gmail => assert!(stack.gmail().faults().is_empty()),
        Provider::Outlook => assert!(stack.outlook().faults().is_empty()),
    }

    // A failed Send is not retried behind the user's back.
    stack.run_scheduled_sweep().await?;
    deliver_marker(&from, &to).await?;
    assert_eq!(to.previews("inbox").await?.len(), 1);
    // A second copy would join the first one's thread: count messages too.
    assert_eq!(to.provider_messages()?.len(), 1);
    let still = from.send_attempt_state(attempt_id).await?;
    assert_eq!(still["status"], "FAILED", "{still}");

    let undone = from.cancel_send(attempt_id).await?;
    assert_eq!(undone["status"], "CANCELLED", "{undone}");
    assert_eq!(undone["message"]["isDraft"], true, "{undone}");
    assert_eq!(undone["message"]["bodyText"], "Final terms.", "{undone}");
    from.wait_for_preview("drafts", "Offer").await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_refused_send_fails_and_can_be_taken_back() -> Result<(), Report> {
    refused_send_fails_and_can_be_taken_back(stack_with_graphql().await?, Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_refused_send_fails_and_can_be_taken_back() -> Result<(), Report> {
    refused_send_fails_and_can_be_taken_back(stack_with_graphql().await?, Provider::Outlook).await
}
