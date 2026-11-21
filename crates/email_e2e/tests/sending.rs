//! Sending mail from Macro.

use email_e2e::{Provider, Report, Stack};
use serde_json::json;

/// A message sent through the API leaves through the provider, reaches the
/// recipient's mailbox there, and both sides see it in Macro: the sender in
/// Sent, the recipient in their inbox.
async fn send_reaches_the_other_mailbox(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    from.send(&json!({
        "subject": "Quarterly numbers",
        "to": [{ "email": grace.email() }],
        "body_text": "They are in.",
    }))
    .await?;

    let received = to.wait_for_preview("inbox", "Quarterly numbers").await?;
    assert_eq!(received["senderEmail"], ada.email());
    let thread = to
        .thread(received["id"].as_str().unwrap_or_default())
        .await?;
    assert_eq!(thread["messages"][0]["body_text"], "They are in.");

    from.wait_for_preview("sent", "Quarterly numbers").await?;
    let at_provider = to
        .wait_for_provider_message("the message in the recipient's mailbox", |message| {
            message.subject == "Quarterly numbers"
        })
        .await?;
    assert!(at_provider.in_inbox);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_send_reaches_the_other_mailbox() -> Result<(), Report> {
    send_reaches_the_other_mailbox(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_send_reaches_the_other_mailbox() -> Result<(), Report> {
    send_reaches_the_other_mailbox(Provider::Outlook).await
}
