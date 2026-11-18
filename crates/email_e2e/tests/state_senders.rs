//! Rules about senders: which mail counts as signal, and blocked senders.

#![expect(
    clippy::disallowed_methods,
    reason = "a scenario reads and seeds its own database, which the query cache does not describe"
)]

use email_e2e::{Inbox, Mail, Provider, Report, Stack};
use rootcause::prelude::*;
use serde_json::{Value, json};
use uuid::Uuid;

/// Whether Macro counts the thread as signal (the list of mail that matters).
async fn is_signal(stack: &Stack, preview: &Value) -> Result<bool, Report> {
    let id: Uuid = preview["id"]
        .as_str()
        .and_then(|id| id.parse().ok())
        .ok_or_else(|| report!("the preview has no thread id: {preview}"))?;
    let signal: bool = sqlx::query_scalar("SELECT is_signal FROM email_threads WHERE id = $1")
        .bind(id)
        .fetch_one(stack.db())
        .await
        .context("could not read the thread's signal flag")?;
    Ok(signal)
}

/// Delivers a mail from `from` and returns its preview once synced.
async fn receive(inbox: &Inbox, from: &str, subject: &str) -> Result<Value, Report> {
    inbox.deliver(&Mail::new(from, subject, "Body."))?;
    inbox.wait_for_preview("all", subject).await
}

/// Marking a sender as noise takes their mail, old and new, out of signal
/// in that inbox, and marking them important again brings it back; other
/// senders are not touched.
///
/// When it fails: "mark as noise" appears to work but the sender's mail
/// keeps showing up as signal, or other senders' mail drops out.
async fn a_sender_marked_noise_leaves_signal(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let before = receive(&inbox, "News <news@example.net>", "Issue 1").await?;
    let other = receive(&inbox, "Grace <grace@example.com>", "Lunch").await?;
    assert!(is_signal(&stack, &before).await?);
    assert!(is_signal(&stack, &other).await?);

    let set_rule = async |important: bool| -> Result<(), Report> {
        inbox
            .put(
                "/email/filters",
                Some(&json!({
                    "email_address": "news@example.net",
                    "email_domain": null,
                    "is_important": important,
                })),
            )
            .await?
            .ok()?;
        Ok(())
    };
    set_rule(false).await?;

    let after = receive(&inbox, "News <news@example.net>", "Issue 2").await?;
    assert!(
        !is_signal(&stack, &after).await?,
        "new mail from the sender is noise"
    );
    email_e2e::eventually(
        "the sender's earlier mail to leave signal",
        email_e2e::DEFAULT_TIMEOUT,
        async || Ok((!is_signal(&stack, &before).await?).then_some(())),
    )
    .await?;
    let unrelated = receive(&inbox, "Grace <grace@example.com>", "Dinner").await?;
    assert!(is_signal(&stack, &unrelated).await?);
    assert!(is_signal(&stack, &other).await?);

    set_rule(true).await?;
    let again = receive(&inbox, "News <news@example.net>", "Issue 3").await?;
    assert!(
        is_signal(&stack, &again).await?,
        "the sender is signal again"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_sender_marked_noise_leaves_signal() -> Result<(), Report> {
    a_sender_marked_noise_leaves_signal(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_sender_marked_noise_leaves_signal() -> Result<(), Report> {
    a_sender_marked_noise_leaves_signal(Provider::Outlook).await
}

/// Blocking a sender sets the provider up to throw their mail away, so the
/// next mail from them lands in Trash; unblocking lets it into the inbox.
///
/// When it fails: "block sender" answers success but their mail keeps
/// arriving in the inbox, or mail keeps being thrown away after unblocking.
async fn a_blocked_sender_goes_to_trash(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    receive(&inbox, "Mallory <mallory@example.net>", "Offer 1").await?;

    inbox
        .post(
            "/email/contacts/block",
            Some(&json!({ "email_address": "mallory@example.net" })),
        )
        .await?
        .ok()?;
    email_e2e::eventually(
        "the sender to be listed as blocked",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            let blocked = inbox.get("/email/contacts/blocked").await?.ok()?;
            Ok(blocked
                .to_string()
                .contains("mallory@example.net")
                .then_some(blocked))
        },
    )
    .await?;

    // The rule reaches the provider a moment after the API answers; mail
    // sent from then on is thrown away.
    let thrown = deliver_until(&inbox, "Thrown", false).await?;
    let preview = inbox.wait_for_preview("trash", &thrown).await?;
    assert!(
        !inbox
            .previews("inbox")
            .await?
            .iter()
            .any(|listed| listed["id"] == preview["id"]),
        "mail from a blocked sender is not in the inbox"
    );

    inbox
        .post(
            "/email/contacts/unblock",
            Some(&json!({ "email_address": "mallory@example.net" })),
        )
        .await?
        .ok()?;
    let kept = deliver_until(&inbox, "Kept", true).await?;
    inbox.wait_for_preview("inbox", &kept).await?;
    let blocked = inbox.get("/email/contacts/blocked").await?.ok()?;
    assert!(!blocked.to_string().contains("mallory@example.net"));

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_blocked_sender_goes_to_trash() -> Result<(), Report> {
    a_blocked_sender_goes_to_trash(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_blocked_sender_goes_to_trash() -> Result<(), Report> {
    a_blocked_sender_goes_to_trash(Provider::Outlook).await
}

/// Delivers mail from the blocked sender until the provider files one in
/// the inbox (`in_inbox`) or throws one away, and returns its subject.
async fn deliver_until(inbox: &Inbox, prefix: &str, in_inbox: bool) -> Result<String, Report> {
    let mut attempt = 0;
    email_e2e::eventually(
        "the provider to apply the sender's rule",
        email_e2e::DEFAULT_TIMEOUT,
        async || {
            attempt += 1;
            let subject = format!("{prefix} {attempt}");
            let delivered = inbox.deliver(&Mail::new(
                "Mallory <mallory@example.net>",
                &subject,
                "Buy.",
            ))?;
            let filed = inbox.provider_message(&delivered.id)?;
            Ok(filed
                .is_some_and(|message| {
                    // Gmail adds TRASH; Outlook moves the message out of the inbox.
                    let thrown =
                        !message.in_inbox || message.labels.iter().any(|label| label == "TRASH");
                    thrown != in_inbox
                })
                .then_some(subject))
        },
    )
    .await
}
