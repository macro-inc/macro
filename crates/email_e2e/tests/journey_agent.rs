//! What an AI agent does in a user's mail with the email tools: drafting a
//! reply with SendEmail and sending it once the user confirms, reading the
//! inbox's labels with ListLabels, and deciding where a sender's mail lands
//! with SetSenderPolicy.
//!
//! The tools run in the test process on the scenario's database and
//! queues; the scenario's workers carry out what they stage, so each
//! outcome is checked where the user would see it: the recipient's
//! mailbox, Macro's lists and the provider.

#![recursion_limit = "256"]

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use email_e2e::{
    DEFAULT_TIMEOUT, EmailTools, Inbox, Mail, Provider, ProviderMessage, Report, Stack,
    StackOptions, User, eventually,
};
use rootcause::report;
use serde_json::{Value, json};

const MALLORY: &str = "Mallory <mallory@example.com>";

async fn stack_with_lists() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await
}

/// Calls a tool and fails the scenario with the model's error if it
/// refuses.
async fn call(tools: &EmailTools, user: &User, name: &str, input: &Value) -> Result<Value, Report> {
    tools
        .call(user, name, input)
        .await?
        .map_err(|refusal| report!("{name} refused: {refusal}"))
}

/// The agent drafts a reply to a thread Grace started with SendEmail, which
/// hands it to the user's composer and sends nothing, then sends it with
/// SendConfirmedEmail once the user agrees, with the user's saved
/// signature. Grace receives one reply, in her own thread, with the body
/// and the signature under it, and Ada's thread holds both messages.
///
/// When it fails, the draft goes out before the user confirms, the reply
/// starts a new thread, goes out without the signature the user asked for,
/// or is not recorded in Ada's thread.
async fn agent_drafts_then_sends_a_signed_reply(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let correspondent = grace.link(provider, grace.email()).await?;
    let tools = stack.email_tools()?;

    inbox
        .patch(
            "/email/settings",
            Some(&json!({ "settings": {
                "signature": "<p>Ada Example, Operations</p>",
                "signature_on_replies_forwards": true,
            } })),
        )
        .await?
        .ok()?;
    correspondent
        .send(&json!({
            "subject": "Site visit",
            "to": [{ "email": ada.email() }],
            "body_text": "Can you host us on Thursday?",
        }))
        .await?;
    let preview = inbox.wait_for_preview("inbox", "Site visit").await?;
    let thread_id = preview["id"].as_str().unwrap_or_default().to_owned();
    let thread = inbox.thread(&thread_id).await?;

    let reply = json!({
        "subject": "Re: Site visit",
        "body": URL_SAFE_NO_PAD.encode("<p>Thursday works, see you at ten.</p>"),
        "to": [{ "email": grace.email() }],
        "replyingToId": thread["messages"][0]["db_id"],
        "includeSignature": true,
    });
    // SendEmail hands the draft to the user's composer and sends nothing.
    let drafted = call(&tools, &ada, "SendEmail", &reply).await?;
    assert_eq!(drafted, "PendingUserExecution", "{drafted}");

    let mut confirmed = reply.clone();
    confirmed["userConfirmation"] = json!("Yes, send it.");
    let sent = call(&tools, &ada, "SendConfirmedEmail", &confirmed).await?;
    assert_eq!(sent["sent"]["thread_id"], thread_id.as_str(), "{sent}");

    let original = correspondent
        .wait_for_provider_message("Grace's own copy of her mail", |message| {
            message.subject == "Site visit"
        })
        .await?;
    let reply = correspondent
        .wait_for_provider_message("the reply at Grace's provider", |message| {
            message.subject == "Re: Site visit" && message.in_inbox
        })
        .await?;
    assert_eq!(
        reply.thread_id, original.thread_id,
        "the reply started a new thread: {reply:?}"
    );

    let received = correspondent
        .wait_for_preview("inbox", "Re: Site visit")
        .await?;
    let received = correspondent
        .thread(received["id"].as_str().unwrap_or_default())
        .await?;
    let html = received["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|message| message["body_html_sanitized"].as_str())
        .find(|html| html.contains("Thursday works"))
        .unwrap_or_default()
        .to_owned();
    let body = html.find("Thursday works");
    let signature = html.find("Ada Example, Operations");
    assert!(
        body.is_some() && signature.is_some() && body < signature,
        "the reply has no signature under its text: {html}"
    );
    assert_eq!(html.matches("Ada Example, Operations").count(), 1, "{html}");

    let ours = inbox
        .wait_for_thread(&thread_id, "the reply in Ada's thread", |thread| {
            thread["messages"].as_array().map_or(0, Vec::len) == 2
        })
        .await?;
    let sent = ours["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|message| message["subject"] == "Re: Site visit");
    assert!(
        sent.is_some_and(|message| message["is_sent"] == true),
        "Ada's thread does not hold the reply she sent: {ours}"
    );
    let copies = correspondent
        .provider_messages()?
        .iter()
        .filter(|message| message.subject == "Re: Site visit")
        .count();
    assert_eq!(copies, 1, "Grace got the reply {copies} times");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_agent_drafts_then_sends_a_signed_reply() -> Result<(), Report> {
    agent_drafts_then_sends_a_signed_reply(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_agent_drafts_then_sends_a_signed_reply() -> Result<(), Report> {
    agent_drafts_then_sends_a_signed_reply(Provider::Outlook).await
}

/// The names of the labels ListLabels answered, of one type.
fn label_names(listed: &Value, kind: &str) -> Vec<String> {
    listed["labels"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|label| label["type"] == kind)
        .filter_map(|label| label["name"].as_str().map(str::to_owned))
        .collect()
}

/// The agent lists an inbox's labels, named by the inbox or by one of its
/// threads: the system labels and the label the user made, in the inbox
/// that holds the thread and no other.
///
/// When it fails, the agent cannot find a label the user made, or is shown
/// the labels of another inbox.
async fn agent_lists_the_inbox_labels(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let primary = ada.link(provider, ada.email()).await?;
    let second = ada.link(provider, "ada.work@example.com").await?;
    let tools = stack.email_tools()?;

    for (inbox, name) in [(&primary, "Receipts"), (&second, "Contracts")] {
        inbox
            .post("/email/labels", Some(&json!({ "label_name": name })))
            .await?
            .ok()?;
    }
    second.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Clause four",
        "Hi.",
    ))?;
    let preview = second.wait_for_preview("inbox", "Clause four").await?;

    let by_inbox = call(
        &tools,
        &ada,
        "ListLabels",
        &json!({ "inbox": second.email() }),
    )
    .await?;
    let by_thread = call(
        &tools,
        &ada,
        "ListLabels",
        &json!({ "thread_id": preview["id"] }),
    )
    .await?;
    let primary_labels = call(&tools, &ada, "ListLabels", &json!({})).await?;

    for listed in [&by_inbox, &by_thread] {
        assert_eq!(label_names(listed, "user"), ["Contracts"], "{listed}");
        // Outlook keeps folders, not system labels.
        if provider == Provider::Gmail {
            assert!(
                label_names(listed, "system").contains(&"INBOX".to_owned()),
                "{listed}"
            );
        }
    }
    assert_eq!(
        label_names(&primary_labels, "user"),
        ["Receipts"],
        "{primary_labels}"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_agent_lists_the_inbox_labels() -> Result<(), Report> {
    agent_lists_the_inbox_labels(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_agent_lists_the_inbox_labels() -> Result<(), Report> {
    agent_lists_the_inbox_labels(Provider::Outlook).await
}

/// Whether the web app lists the inbox thread named `subject` as Signal
/// (`Some(true)`), Noise (`Some(false)`), or not at all.
async fn importance(inbox: &Inbox, subject: &str) -> Result<Option<bool>, Report> {
    for signal in [true, false] {
        let page = inbox
            .user()
            .email_list_page(
                &json!({
                    "ef": { "l": { "Importance": signal } },
                    "emailView": "inbox",
                    "limit": 100,
                }),
                None,
            )
            .await?
            .ok()?;
        let listed = page["items"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|item| item["data"]["name"] == subject);
        if listed {
            return Ok(Some(signal));
        }
    }
    Ok(None)
}

async fn wait_importance(inbox: &Inbox, subject: &str, signal: bool) -> Result<(), Report> {
    let view = if signal { "Signal" } else { "Noise" };
    eventually(
        &format!("{subject:?} to be listed in {view}"),
        DEFAULT_TIMEOUT,
        async || Ok((importance(inbox, subject).await? == Some(signal)).then_some(())),
    )
    .await
}

fn filed_away(message: &ProviderMessage, provider: Provider) -> bool {
    match provider {
        Provider::Gmail => message.labels.iter().any(|label| label == "TRASH"),
        Provider::Outlook => !message.in_inbox,
    }
}

/// The agent sets where a sender's mail lands, from one of their threads:
/// Noise, then Signal, then Block. Each policy decides where the sender's
/// next mail lands, and Block is held at the provider, which files the
/// next mail away.
///
/// When it fails, the tool reports a policy that the lists or the
/// provider do not follow, or a later policy does not replace an earlier
/// one.
async fn agent_sets_where_a_senders_mail_lands(provider: Provider) -> Result<(), Report> {
    let stack = stack_with_lists().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let tools = stack.email_tools()?;

    inbox.deliver(&Mail::new(MALLORY, "Weekly deals", "Hello."))?;
    let preview = inbox.wait_for_preview("inbox", "Weekly deals").await?;
    wait_importance(&inbox, "Weekly deals", true).await?;

    let policy = async |policy: &str| -> Result<Value, Report> {
        call(
            &tools,
            &ada,
            "SetSenderPolicy",
            &json!({
                "sender_email": "mallory@example.com",
                "policy": policy,
                "thread_id": preview["id"],
            }),
        )
        .await
    };

    let noise = policy("noise").await?;
    assert_eq!(noise["inbox"], ada.email(), "{noise}");
    inbox.deliver(&Mail::new(MALLORY, "More deals", "Hello."))?;
    inbox.wait_for_preview("inbox", "More deals").await?;
    wait_importance(&inbox, "More deals", false).await?;

    policy("signal").await?;
    inbox.deliver(&Mail::new(MALLORY, "Order shipped", "Hello."))?;
    inbox.wait_for_preview("inbox", "Order shipped").await?;
    wait_importance(&inbox, "Order shipped", true).await?;

    policy("block").await?;
    eventually(
        "the provider to hold the block",
        DEFAULT_TIMEOUT,
        async || {
            let listed = inbox.get("/email/contacts/blocked").await?.ok()?;
            let blocked = listed["blocked_emails"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|address| address == "mallory@example.com");
            Ok(blocked.then_some(()))
        },
    )
    .await?;
    let blocked = inbox.deliver(&Mail::new(MALLORY, "Last chance", "Hello."))?;
    assert!(
        filed_away(&blocked, provider),
        "the provider let the blocked sender's mail into the inbox: {blocked:?}"
    );
    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Compiler notes",
        "Hi.",
    ))?;
    inbox.wait_for_preview("inbox", "Compiler notes").await?;
    assert_eq!(importance(&inbox, "Last chance").await?, None);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_agent_sets_where_a_senders_mail_lands() -> Result<(), Report> {
    agent_sets_where_a_senders_mail_lands(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_agent_sets_where_a_senders_mail_lands() -> Result<(), Report> {
    agent_sets_where_a_senders_mail_lands(Provider::Outlook).await
}
