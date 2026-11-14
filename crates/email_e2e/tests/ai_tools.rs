//! The email tools an AI agent calls, run on the scenario's database and
//! queues, with the real workers carrying out what a tool stages.

#![recursion_limit = "256"]

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use email_e2e::{Inbox, Mail, Provider, Report, Stack, User};
use serde_json::{Value, json};

/// The address of the second inbox a user links.
const SECOND_INBOX: &str = "ada.work@example.com";

/// A body the way a composer hands it to a sending tool: base64url HTML.
fn composed(html: &str) -> String {
    URL_SAFE_NO_PAD.encode(html)
}

/// A user with a primary and a second inbox, and a correspondent whose
/// mail to the second inbox is synced. Returns the thread and the message
/// received there, as Macro knows them.
async fn second_inbox_with_mail(
    stack: &Stack,
    provider: Provider,
) -> Result<(User, Inbox, Inbox, Inbox, Value), Report> {
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let primary = ada.link(provider, ada.email()).await?;
    let second = ada.link(provider, SECOND_INBOX).await?;
    let correspondent = grace.link(provider, grace.email()).await?;

    second.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Contract draft",
        "Could you look at clause four?",
    ))?;
    let preview = second.wait_for_preview("inbox", "Contract draft").await?;
    let thread = second
        .thread(preview["id"].as_str().unwrap_or_default())
        .await?;
    Ok((ada, primary, second, correspondent, thread))
}

/// A reply the agent sends with no inbox named goes out from the inbox that
/// received the thread, in that thread, and a new message naming an inbox
/// goes out from it. When this fails the reply left from the user's primary
/// address, or the tool could not find the message it was replying to.
async fn agent_reply_leaves_from_the_inbox_that_received_the_thread(
    provider: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let (ada, primary, second, correspondent, thread) =
        second_inbox_with_mail(&stack, provider).await?;
    let tools = stack.email_tools()?;
    let received = second
        .wait_for_provider_message("the received message", |message| {
            message.subject == "Contract draft"
        })
        .await?;

    let reply = tools
        .call(
            &ada,
            "SendConfirmedEmail",
            &json!({
                "subject": "Re: Contract draft",
                "body": composed("<p>Clause four is fine.</p>"),
                "to": [{ "email": "grace@example.com" }],
                "userConfirmation": "Yes, send it.",
                "replyingToId": thread["messages"][0]["db_id"],
            }),
        )
        .await?
        .map_err(refused)?;
    assert_eq!(reply["sent"]["thread_id"], thread["db_id"], "{reply}");

    let arrived = correspondent
        .wait_for_provider_message("the agent's reply", |message| {
            message.subject == "Re: Contract draft"
        })
        .await?;
    assert_eq!(
        arrived.from.as_deref().map(address),
        Some(SECOND_INBOX),
        "the reply left from another address"
    );
    let sent = second
        .wait_for_provider_message("the reply in the sending mailbox", |message| {
            message.subject == "Re: Contract draft"
        })
        .await?;
    assert_eq!(sent.thread_id, received.thread_id);

    tools
        .call(
            &ada,
            "SendConfirmedEmail",
            &json!({
                "subject": "Signing date",
                "from": SECOND_INBOX,
                "body": composed("<p>Friday works.</p>"),
                "to": [{ "email": "grace@example.com" }],
                "userConfirmation": "Yes, send it.",
            }),
        )
        .await?
        .map_err(refused)?;
    let arrived = correspondent
        .wait_for_provider_message("the agent's new message", |message| {
            message.subject == "Signing date"
        })
        .await?;
    assert_eq!(arrived.from.as_deref().map(address), Some(SECOND_INBOX));
    assert!(
        primary.provider_messages()?.iter().all(|message| !matches!(
            message.subject.as_str(),
            "Re: Contract draft" | "Signing date"
        )),
        "the primary mailbox sent one of the agent's messages"
    );

    stack.finish().await
}

/// A tool refusal as the scenario's failure.
fn refused(refusal: String) -> Report {
    rootcause::report!("the tool refused the call: {refusal}")
}

/// The address in a `Name <address>` header value.
fn address(header: &str) -> &str {
    header
        .rsplit_once('<')
        .map_or(header, |(_, rest)| rest.trim_end_matches('>'))
        .trim()
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_agent_reply_leaves_from_the_inbox_that_received_the_thread() -> Result<(), Report> {
    agent_reply_leaves_from_the_inbox_that_received_the_thread(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_agent_reply_leaves_from_the_inbox_that_received_the_thread() -> Result<(), Report>
{
    agent_reply_leaves_from_the_inbox_that_received_the_thread(Provider::Outlook).await
}

/// The agent reads a thread in the user's second inbox as the user's own
/// API calls do, is told which inbox holds it, and lists both inboxes.
/// When this fails the tool refuses a thread the user can open.
async fn agent_reads_a_thread_in_a_second_inbox(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let (ada, primary, second, _correspondent, thread) =
        second_inbox_with_mail(&stack, provider).await?;
    let tools = stack.email_tools()?;

    let read = tools
        .call(&ada, "GetThread", &json!({ "threadId": thread["db_id"] }))
        .await?
        .map_err(refused)?;
    assert_eq!(read["inbox"], SECOND_INBOX, "{read}");
    assert_eq!(read["messages"][0]["subject"], "Contract draft");
    assert_eq!(read["messages"][0]["from"]["email"], "grace@example.com");

    let inboxes = tools
        .call(&ada, "ListInboxes", &json!({}))
        .await?
        .map_err(refused)?;
    let mut listed: Vec<(&str, bool)> = inboxes["inboxes"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|inbox| {
            (
                inbox["emailAddress"].as_str().unwrap_or_default(),
                inbox["isPrimary"] == true,
            )
        })
        .collect();
    listed.sort_unstable();
    assert_eq!(listed, [(SECOND_INBOX, false), (primary.email(), true)]);
    drop(second);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_agent_reads_a_thread_in_a_second_inbox() -> Result<(), Report> {
    agent_reads_a_thread_in_a_second_inbox(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_agent_reads_a_thread_in_a_second_inbox() -> Result<(), Report> {
    agent_reads_a_thread_in_a_second_inbox(Provider::Outlook).await
}

/// The agent archiving a thread takes it out of the inbox at the provider.
/// When this fails the tool reports success, or an error, and the mailbox
/// is unchanged.
async fn agent_archive_reaches_the_provider(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let (ada, _primary, second, _correspondent, thread) =
        second_inbox_with_mail(&stack, provider).await?;
    let tools = stack.email_tools()?;

    let archived = tools
        .call(
            &ada,
            "UpdateThreadLabels",
            &json!({ "thread_id": thread["db_id"], "label": "INBOX", "add": false }),
        )
        .await?
        .map_err(refused)?;
    assert_eq!(archived["failedCount"], 0, "{archived}");

    second
        .wait_for_provider_message("the archived message", |message| {
            message.subject == "Contract draft" && !message.in_inbox
        })
        .await?;
    second
        .wait_for_preview_where("all", "the archived thread out of the inbox", |preview| {
            preview["name"] == "Contract draft" && preview["inboxVisible"] == false
        })
        .await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_agent_archive_reaches_the_provider() -> Result<(), Report> {
    agent_archive_reaches_the_provider(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_agent_archive_reaches_the_provider() -> Result<(), Report> {
    agent_archive_reaches_the_provider(Provider::Outlook).await
}
