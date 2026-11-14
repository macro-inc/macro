//! Attachments, in and out.

use email_e2e::{Mail, Provider, Report, Stack};
use serde_json::json;

const REPORT: &[u8] = b"%PDF-1.4 the quarterly report";

/// An attachment on mail that arrives is listed on the message and
/// downloads with the bytes the sender attached.
async fn received_attachment_downloads(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    inbox.deliver(
        &Mail::new("Grace <grace@example.com>", "The report", "See attached.").with_attachment(
            "report.pdf",
            "application/pdf",
            REPORT,
        ),
    )?;
    let preview = inbox.wait_for_preview("inbox", "The report").await?;
    let thread = inbox
        .wait_for_thread(
            preview["id"].as_str().unwrap_or_default(),
            "the message to list its attachment",
            |thread| thread["messages"][0]["attachments"][0]["db_id"].is_string(),
        )
        .await?;
    let attachment = &thread["messages"][0]["attachments"][0];
    assert_eq!(attachment["filename"], "report.pdf");

    let bytes = inbox
        .download_attachment(attachment["db_id"].as_str().unwrap_or_default())
        .await?;
    assert_eq!(bytes.as_ref(), REPORT);

    stack.finish().await
}

/// A file attached to a draft is sent with it and arrives intact.
async fn sent_attachment_arrives(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    let message = json!({
        "subject": "Report attached",
        "to": [{ "email": grace.email() }],
        "body_text": "Here it is.",
    });
    let draft = from.save_draft(&message).await?;
    let draft_id = draft["db_id"].as_str().unwrap_or_default();
    let generation = draft["draft_generation"].as_i64().unwrap_or_default();
    from.attach_to_draft(draft_id, generation, "report.pdf", REPORT)
        .await?;

    let mut message = message;
    message["db_id"] = json!(draft_id);
    message["draft_generation"] = json!(generation);
    from.send(&message).await?;

    let preview = to.wait_for_preview("inbox", "Report attached").await?;
    let thread = to
        .wait_for_thread(
            preview["id"].as_str().unwrap_or_default(),
            "the received message to list its attachment",
            |thread| thread["messages"][0]["attachments"][0]["db_id"].is_string(),
        )
        .await?;
    let attachment = &thread["messages"][0]["attachments"][0];
    assert_eq!(attachment["filename"], "report.pdf");
    let bytes = to
        .download_attachment(attachment["db_id"].as_str().unwrap_or_default())
        .await?;
    assert_eq!(bytes.as_ref(), REPORT);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_received_attachment_downloads() -> Result<(), Report> {
    received_attachment_downloads(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_received_attachment_downloads() -> Result<(), Report> {
    received_attachment_downloads(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_sent_attachment_arrives() -> Result<(), Report> {
    sent_attachment_arrives(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_sent_attachment_arrives() -> Result<(), Report> {
    sent_attachment_arrives(Provider::Outlook).await
}
