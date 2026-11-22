//! Outlook inboxes, end to end.

use email_e2e::{Mail, Report, Stack};

/// New mail reaches Macro through Graph's change notification and the
/// mailbox sync that follows, and is readable through the API, in its thread.
#[tokio::test(flavor = "multi_thread")]
async fn new_mail_arrives_through_sync() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_outlook().await?;

    let first = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Lunch on Friday?",
        "Are you free at noon?",
    ))?;
    let preview = inbox.wait_for_preview("inbox", "Lunch on Friday?").await?;
    assert_eq!(preview["senderEmail"], "grace@example.com");
    assert_eq!(preview["isRead"], false);

    let thread_id = preview["id"].as_str().unwrap_or_default();
    let thread = inbox.thread(thread_id).await?;
    assert_eq!(thread["provider_id"], first.thread_id.as_str());
    assert_eq!(thread["messages"][0]["body_text"], "Are you free at noon?");

    stack.finish().await
}
