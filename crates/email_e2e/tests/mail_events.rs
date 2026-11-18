//! The mail events the email services publish for the rest of Macro:
//! activity, routines and suggestions hear of mail through them.

use email_e2e::{DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, eventually};
use serde_json::{Value, json};

/// The events of one kind published about the inbox so far.
async fn events_of(stack: &Stack, inbox: &Inbox, kind: &str) -> Result<Vec<Value>, Report> {
    Ok(stack
        .email_events(inbox.link_id())
        .await?
        .into_iter()
        .filter(|event| event["event_type"] == kind)
        .collect())
}

/// Waits for the first event of one kind about the inbox and returns its
/// metadata.
async fn wait_for_event(stack: &Stack, inbox: &Inbox, kind: &str) -> Result<Value, Report> {
    eventually(
        &format!("an {kind} event about {}", inbox.email()),
        DEFAULT_TIMEOUT,
        async || {
            Ok(events_of(stack, inbox, kind)
                .await?
                .first()
                .map(|event| event["metadata"].clone()))
        },
    )
    .await
}

/// Mail that arrives is published once as received, naming the thread the
/// inbox lists it under, and mail sent from Macro once as sent by the
/// user's own action, on both sides of the exchange.
///
/// When it fails: the activity feed, routines triggered by mail and reply
/// suggestions never hear of new or sent mail, or hear of it twice.
async fn received_and_sent_mail_is_published_once(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let ada_inbox = ada.link(provider, ada.email()).await?;
    let grace_inbox = grace.link(provider, grace.email()).await?;

    let delivered = ada_inbox.deliver(&Mail::new(
        "Carol <carol@example.net>",
        "Site visit",
        "Is Tuesday fine?",
    ))?;
    let preview = ada_inbox.wait_for_preview("inbox", "Site visit").await?;
    let received = wait_for_event(&stack, &ada_inbox, "email.message_received").await?;
    assert_eq!(received["thread_id"], preview["id"], "{received}");
    assert_eq!(received["provider_message_id"], delivered.id.as_str());
    assert_eq!(received["owner"], ada.macro_id());
    assert_eq!(received["from_email"], "carol@example.net");
    assert_eq!(received["is_new_thread"], true);

    let sent = ada_inbox
        .send(&json!({
            "subject": "Quarterly numbers",
            "to": [{ "email": grace.email() }],
            "body_text": "They are in.",
        }))
        .await?;
    let at_provider = ada_inbox
        .wait_for_provider_message("the sent message in the sender's mailbox", |message| {
            message.subject == "Quarterly numbers"
                && !message
                    .labels
                    .iter()
                    .any(|label| label == "DRAFT" || label.eq_ignore_ascii_case("drafts"))
        })
        .await?;
    let published = wait_for_event(&stack, &ada_inbox, "email.message_sent").await?;
    assert_eq!(published["origin"], "user_action", "{published}");
    assert_eq!(published["message_id"], sent["db_id"]);
    assert_eq!(published["provider_message_id"], at_provider.id.as_str());
    assert_eq!(published["actor"], ada.macro_id());
    assert_eq!(published["to_emails"], json!([grace.email()]));

    // The recipient's side hears of the same mail as received.
    let arrived = grace_inbox
        .wait_for_preview("inbox", "Quarterly numbers")
        .await?;
    let heard = wait_for_event(&stack, &grace_inbox, "email.message_received").await?;
    assert_eq!(heard["thread_id"], arrived["id"], "{heard}");
    assert_eq!(heard["from_email"], ada.email());

    // Everything later has been published by now, so a second announcement
    // of the first mail would be here too.
    let received = events_of(&stack, &ada_inbox, "email.message_received").await?;
    assert_eq!(received.len(), 1, "{received:?}");
    let sent = events_of(&stack, &ada_inbox, "email.message_sent").await?;
    assert_eq!(sent.len(), 1, "{sent:?}");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_received_and_sent_mail_is_published_once() -> Result<(), Report> {
    received_and_sent_mail_is_published_once(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_received_and_sent_mail_is_published_once() -> Result<(), Report> {
    received_and_sent_mail_is_published_once(Provider::Outlook).await
}
