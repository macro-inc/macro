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

/// An attachment on a draft opens: a draft with a PDF, written in the
/// provider's own composer, lists the file in Macro and the file downloads
/// with the bytes that were attached, while the message is still a draft.
/// When this fails, a file on a draft cannot be previewed before sending.
async fn attachment_on_a_draft_downloads(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    match provider {
        Provider::Gmail => {
            // Saved through Gmail's drafts API, as its own composer does.
            use base64::Engine as _;
            use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
            let raw = format!(
                "From: {from}\r\nTo: grace@example.com\r\nSubject: Report in progress\r\n\
                 MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"part\"\r\n\r\n\
                 --part\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nAttached.\r\n\
                 --part\r\nContent-Type: application/pdf; name=\"report.pdf\"\r\n\
                 Content-Disposition: attachment; filename=\"report.pdf\"\r\n\
                 Content-Transfer-Encoding: base64\r\n\r\n{report}\r\n--part--\r\n",
                from = inbox.email(),
                report = STANDARD.encode(REPORT),
            );
            reqwest::Client::new()
                .post(format!("{}/users/me/drafts", stack.gmail().gmail_url()))
                .bearer_auth(stack.gmail().access_token(inbox.email())?)
                .json(&json!({ "message": { "raw": URL_SAFE_NO_PAD.encode(raw) } }))
                .send()
                .await?
                .error_for_status()?;
        }
        Provider::Outlook => {
            stack.outlook().deliver(
                inbox.email(),
                &email_e2e::outlook_emulator::NewMessage {
                    to: Some("grace@example.com".to_owned()),
                    subject: Some("Report in progress".to_owned()),
                    text: Some("Attached.".to_owned()),
                    folder: Some("drafts".to_owned()),
                    attachments: vec![email_e2e::outlook_emulator::NewAttachment {
                        filename: "report.pdf".to_owned(),
                        mime_type: Some("application/pdf".to_owned()),
                        text: Some(String::from_utf8_lossy(REPORT).into_owned()),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            )?;
        }
    }

    let preview = inbox.wait_for_preview("all", "Report in progress").await?;
    let thread = inbox
        .wait_for_thread(
            preview["id"].as_str().unwrap_or_default(),
            "the draft to list its attachment",
            |thread| thread["messages"][0]["attachments"][0]["db_id"].is_string(),
        )
        .await?;
    let draft = &thread["messages"][0];
    assert_eq!(draft["is_draft"], true, "{draft}");
    let attachment = &draft["attachments"][0];
    assert_eq!(attachment["filename"], "report.pdf");

    let bytes = inbox
        .download_attachment(attachment["db_id"].as_str().unwrap_or_default())
        .await?;
    assert_eq!(bytes.as_ref(), REPORT);
    // Opening it sent nothing and left the draft a draft.
    let after = inbox
        .thread(preview["id"].as_str().unwrap_or_default())
        .await?;
    assert_eq!(after["messages"][0]["is_draft"], true, "{after}");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_attachment_on_a_draft_downloads() -> Result<(), Report> {
    attachment_on_a_draft_downloads(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_attachment_on_a_draft_downloads() -> Result<(), Report> {
    attachment_on_a_draft_downloads(Provider::Outlook).await
}
