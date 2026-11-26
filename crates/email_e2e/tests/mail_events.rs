//! The mail events the email services publish for the rest of Macro:
//! activity, routines and suggestions hear of mail through them, and Email
//! labeled routines of the labels a thread gains.

#![recursion_limit = "256"]

use email_e2e::outlook_emulator::MessageChange;
use email_e2e::{DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, User, eventually};
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

/// A label of the inbox owner's own, made in Macro: its Macro id, and how the
/// provider names it on a message (a Gmail label id, an Outlook category).
async fn own_label(user: &User, inbox: &Inbox, name: &str) -> Result<(String, String), Report> {
    let created = inbox
        .post("/email/labels", Some(&json!({ "label_name": name })))
        .await?
        .ok()?;
    let id = created["label"]["id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let at_provider = eventually(
        "Macro to know the provider's label",
        DEFAULT_TIMEOUT,
        async || {
            let labels = user.get("/email/labels").await?.ok()?;
            Ok(labels["labels"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|label| label["id"] == id.as_str())
                .and_then(|label| label["providerLabelId"].as_str())
                .filter(|known| inbox.provider() == Provider::Outlook || *known != name)
                .map(str::to_owned))
        },
    )
    .await?;
    let on_message = match inbox.provider() {
        Provider::Gmail => at_provider,
        Provider::Outlook => name.to_owned(),
    };
    Ok((id, on_message))
}

/// The labels an event says its thread gained.
fn gained(metadata: &Value) -> Vec<String> {
    metadata["labels_gained"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|id| id.as_str().map(str::to_owned))
        .collect()
}

/// The label events about the inbox that name labels a thread gained.
async fn gains(stack: &Stack, inbox: &Inbox) -> Result<Vec<Value>, Report> {
    Ok(events_of(stack, inbox, "email.thread_labels_updated")
        .await?
        .into_iter()
        .map(|event| event["metadata"].clone())
        .filter(|metadata| !gained(metadata).is_empty())
        .collect())
}

/// Waits for a label event naming a label the thread gained.
async fn wait_for_gain(stack: &Stack, inbox: &Inbox, thread: &Value) -> Result<Value, Report> {
    eventually(
        &format!("a label the thread {thread} gained"),
        DEFAULT_TIMEOUT,
        async || {
            Ok(gains(stack, inbox)
                .await?
                .into_iter()
                .find(|metadata| metadata["thread_id"] == *thread))
        },
    )
    .await
}

/// Waits until `count` messages have been published as received, and
/// returns their metadata.
async fn wait_for_received(
    stack: &Stack,
    inbox: &Inbox,
    count: usize,
) -> Result<Vec<Value>, Report> {
    eventually(
        &format!("{count} received messages in {}", inbox.email()),
        DEFAULT_TIMEOUT,
        async || {
            let received: Vec<Value> = events_of(stack, inbox, "email.message_received")
                .await?
                .into_iter()
                .map(|event| event["metadata"].clone())
                .collect();
            Ok((received.len() >= count).then_some(received))
        },
    )
    .await
}

/// A label the inbox's owner puts on a message at the provider is published
/// once, as a label its thread gained; a reply that arrives with a label the
/// thread already has gains nothing.
///
/// When it fails: routines on Email labeled never start for labels added in
/// Gmail or Outlook, or start again for each message of a labeled thread.
async fn a_label_added_at_the_provider_is_published_as_gained(
    provider: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let (label, on_message) = own_label(&ada, &inbox, "Clients").await?;

    let first = inbox.deliver(&Mail {
        message_id: Some("site-visit@example.net".to_owned()),
        ..Mail::new(
            "Carol <carol@example.net>",
            "Site visit",
            "Is Tuesday fine?",
        )
    })?;
    let thread = inbox.wait_for_preview("inbox", "Site visit").await?["id"].clone();
    let received = wait_for_received(&stack, &inbox, 1).await?;
    assert!(gained(&received[0]).is_empty(), "{received:?}");

    match provider {
        Provider::Gmail => {
            stack
                .gmail()
                .modify_labels(inbox.email(), &first.id, &[on_message.clone()], &[])?
        }
        Provider::Outlook => stack.outlook().update_message(
            inbox.email(),
            &first.id,
            &MessageChange {
                categories: Some(vec![on_message.clone()]),
                ..Default::default()
            },
        )?,
    }
    let labeled = wait_for_gain(&stack, &inbox, &thread).await?;
    assert_eq!(gained(&labeled), [label], "{labeled}");
    assert_eq!(labeled.get("automated"), None, "{labeled}");

    inbox.deliver(
        &Mail::new(
            "Carol <carol@example.net>",
            "Re: Site visit",
            "Or Wednesday.",
        )
        .in_reply_to("site-visit@example.net")
        .labeled(&on_message),
    )?;
    let received = wait_for_received(&stack, &inbox, 2).await?;
    assert_eq!(received[1]["thread_id"], thread, "{received:?}");
    assert!(gained(&received[1]).is_empty(), "{received:?}");
    let gains = gains(&stack, &inbox).await?;
    assert_eq!(gains.len(), 1, "{gains:?}");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_label_added_at_the_provider_is_published_as_gained() -> Result<(), Report> {
    a_label_added_at_the_provider_is_published_as_gained(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_label_added_at_the_provider_is_published_as_gained() -> Result<(), Report> {
    a_label_added_at_the_provider_is_published_as_gained(Provider::Outlook).await
}

/// Mail that arrives with one of its owner's labels, as a mail filter puts
/// on, is published as received with the label its new thread gained.
///
/// When it fails: routines on Email labeled miss mail that is filed as it
/// arrives, which is how most labels are put on.
async fn mail_that_arrives_labeled_is_published_with_its_labels(
    provider: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let (label, on_message) = own_label(&ada, &inbox, "Invoices").await?;

    inbox.deliver(
        &Mail::new("Billing <billing@example.net>", "Invoice 42", "Attached.").labeled(&on_message),
    )?;
    let thread = inbox.wait_for_preview("inbox", "Invoice 42").await?["id"].clone();
    let received = wait_for_received(&stack, &inbox, 1).await?;
    assert_eq!(received[0]["thread_id"], thread, "{received:?}");
    assert_eq!(gained(&received[0]), [label], "{received:?}");
    // Arriving labeled is one event: no label event says it again.
    assert!(gains(&stack, &inbox).await?.is_empty());

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_mail_that_arrives_labeled_is_published_with_its_labels() -> Result<(), Report> {
    mail_that_arrives_labeled_is_published_with_its_labels(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_mail_that_arrives_labeled_is_published_with_its_labels() -> Result<(), Report> {
    mail_that_arrives_labeled_is_published_with_its_labels(Provider::Outlook).await
}

/// A category the owner puts on in Macro is published as theirs; the same
/// category put on by an agent's tool is marked automated, so it starts no
/// routine. Outlook only: there the mailbox workers publish the write from
/// the outbox, while a Gmail write is published by the process that made it,
/// and the harness runs the tools in-process with no Kafka publisher (the
/// email crate's message label tests cover Gmail's flag).
///
/// When it fails: an agent or routine sorting the inbox starts routines on
/// Email labeled, and two such routines can set each other off.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_labels_an_agent_adds_are_marked_automated() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(Provider::Outlook, ada.email()).await?;
    let (label, _) = own_label(&ada, &inbox, "Clients").await?;
    inbox.deliver(&Mail::new("Carol <carol@example.net>", "By hand", "One."))?;
    inbox.deliver(&Mail::new(
        "Carol <carol@example.net>",
        "By the agent",
        "Two.",
    ))?;
    let by_hand = inbox.wait_for_preview("inbox", "By hand").await?["id"].clone();
    let by_agent = inbox.wait_for_preview("inbox", "By the agent").await?["id"].clone();

    inbox
        .patch(
            &format!(
                "/email/threads/{}/labels",
                by_hand.as_str().unwrap_or_default()
            ),
            Some(&json!({ "label_id": label, "value": true })),
        )
        .await?
        .ok()?;
    let owners = wait_for_gain(&stack, &inbox, &by_hand).await?;
    assert_eq!(gained(&owners), [label.clone()], "{owners}");
    assert_eq!(owners.get("automated"), None, "{owners}");

    let done = stack
        .email_tools()?
        .call(
            &ada,
            "UpdateThreadLabels",
            &json!({ "thread_id": by_agent, "label_id": label, "add": true }),
        )
        .await?
        .map_err(|refusal| rootcause::report!("the tool refused the call: {refusal}"))?;
    assert_eq!(done["failedCount"], 0, "{done}");
    let agents = wait_for_gain(&stack, &inbox, &by_agent).await?;
    assert_eq!(gained(&agents), [label], "{agents}");
    assert_eq!(agents["automated"], true, "{agents}");

    stack.finish().await
}
