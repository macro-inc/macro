//! Provider faults and expired credentials.

use email_e2e::{Mail, Provider, Report, Stack, gmail_emulator, outlook_emulator};

/// The provider throttles the sync that a new message starts; the mail
/// still arrives once the provider answers again, and nothing is
/// dead-lettered.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_sync_recovers_from_rate_limit() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;

    stack.gmail().inject_fault(gmail_emulator::Fault {
        mailbox: Some(ada.email().to_owned()),
        route: Some(gmail_emulator::Route::HistoryList),
        error: Some(gmail_emulator::FaultError::RateLimit),
        retry_after_seconds: Some(1),
        times: Some(1),
        ..Default::default()
    });
    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "After the storm",
        "Still here.",
    ))?;

    inbox.wait_for_preview("inbox", "After the storm").await?;
    assert!(stack.gmail().faults().is_empty(), "the fault was never hit");
    assert_eq!(stack.dead_letters("gmail-inbox-sync").await?, 0);

    stack.finish().await
}

/// Graph answers 503 to the mailbox's next sync round; the mail still
/// arrives on the retry.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_sync_recovers_from_unavailable() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_outlook().await?;

    stack.outlook().inject_fault(outlook_emulator::Fault {
        mailbox: Some(ada.email().to_owned()),
        route: Some(outlook_emulator::Route::MessagesDelta),
        error: Some(outlook_emulator::FaultError::Unavailable),
        retry_after_seconds: Some(1),
        times: Some(1),
        ..Default::default()
    });
    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "After the storm",
        "Still here.",
    ))?;

    inbox.wait_for_preview("inbox", "After the storm").await?;
    assert!(
        stack.outlook().faults().is_empty(),
        "the fault was never hit"
    );

    stack.finish().await
}

/// Every access token the services hold has expired at the provider; they
/// fetch new ones and mail keeps arriving, with the inbox still linked.
async fn expired_token_is_refreshed(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    inbox.deliver(&Mail::new("Grace <grace@example.com>", "Before", "First."))?;
    inbox.wait_for_preview("inbox", "Before").await?;

    inbox.expire_access_tokens();
    inbox.deliver(&Mail::new("Grace <grace@example.com>", "After", "Second."))?;

    inbox.wait_for_preview("inbox", "After").await?;
    let link = inbox.link().await?;
    assert_eq!(link["needs_reauth"], false, "{link}");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_expired_token_is_refreshed() -> Result<(), Report> {
    expired_token_is_refreshed(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_expired_token_is_refreshed() -> Result<(), Report> {
    expired_token_is_refreshed(Provider::Outlook).await
}
