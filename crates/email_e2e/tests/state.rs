//! Read state travelling between Macro and the provider.

use email_e2e::{Mail, Provider, Report, Stack};
use serde_json::json;

/// Marking a thread read in Macro marks its message read at the provider,
/// and a message read at the provider shows as read in Macro.
async fn read_state_travels_both_ways(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let budget = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Budget review",
        "Numbers attached.",
    ))?;
    let offsite = inbox.deliver(&Mail::new(
        "Alan <alan@example.com>",
        "Offsite agenda",
        "Draft below.",
    ))?;
    let budget_preview = inbox.wait_for_preview("inbox", "Budget review").await?;
    let offsite_preview = inbox.wait_for_preview("inbox", "Offsite agenda").await?;
    assert_eq!(budget_preview["isRead"], false);
    assert_eq!(offsite_preview["isRead"], false);

    // Macro to the provider.
    let budget_thread = budget_preview["id"].as_str().unwrap_or_default();
    inbox
        .patch(
            &format!("/email/threads/{budget_thread}/state"),
            Some(&json!({ "field": "read", "value": true })),
        )
        .await?
        .ok()?;
    inbox
        .wait_for_provider_message("the message to be read at the provider", |message| {
            message.id == budget.id && message.read
        })
        .await?;

    // The other thread is untouched, in Macro and at the provider.
    let offsite_before = inbox.provider_message(&offsite.id)?;
    assert!(offsite_before.is_some_and(|message| !message.read));
    let offsite_now = inbox
        .wait_for_preview_where("inbox", "the other thread", |preview| {
            preview["id"] == offsite_preview["id"]
        })
        .await?;
    assert_eq!(offsite_now["isRead"], false);

    // The provider to Macro.
    inbox.set_read_at_provider(&offsite.id, true)?;
    inbox
        .wait_for_preview_where("inbox", "the thread read at the provider", |preview| {
            preview["id"] == offsite_preview["id"] && preview["isRead"] == true
        })
        .await?;

    // Neither change leaked onto the other thread's message.
    let offsite_at_provider = inbox.provider_message(&offsite.id)?;
    assert!(offsite_at_provider.is_some_and(|message| message.read));
    let budget_now = inbox
        .wait_for_preview_where("inbox", "the thread read in Macro", |preview| {
            preview["id"] == budget_preview["id"]
        })
        .await?;
    assert_eq!(budget_now["isRead"], true);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_read_state_travels_both_ways() -> Result<(), Report> {
    read_state_travels_both_ways(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_read_state_travels_both_ways() -> Result<(), Report> {
    read_state_travels_both_ways(Provider::Outlook).await
}
