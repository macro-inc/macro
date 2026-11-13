//! Linking an inbox and its first sync.

use email_e2e::{Mail, Provider, Report, Stack};

/// Linking an inbox brings in the mail that was already in the mailbox:
/// Gmail through the backfill, Outlook through the first import.
async fn first_sync_brings_existing_mail(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    stack.seed_mailbox(
        provider,
        ada.email(),
        &[
            Mail::new(
                "Grace <grace@example.com>",
                "Welcome aboard",
                "Glad you joined.",
            ),
            Mail::new(
                "Billing <billing@example.com>",
                "Your invoice",
                "Due in 30 days.",
            ),
        ],
    )?;

    let inbox = ada.link(provider, ada.email()).await?;

    let welcome = inbox.wait_for_preview("inbox", "Welcome aboard").await?;
    assert_eq!(welcome["senderEmail"], "grace@example.com");
    inbox.wait_for_preview("inbox", "Your invoice").await?;
    let thread = inbox
        .thread(welcome["id"].as_str().unwrap_or_default())
        .await?;
    assert_eq!(thread["messages"][0]["body_text"], "Glad you joined.");
    assert_eq!(inbox.previews("inbox").await?.len(), 2);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_first_sync_brings_existing_mail() -> Result<(), Report> {
    first_sync_brings_existing_mail(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_first_sync_brings_existing_mail() -> Result<(), Report> {
    first_sync_brings_existing_mail(Provider::Outlook).await
}
