//! Attachments as Macro documents, through the real document storage.

#![expect(
    clippy::disallowed_methods,
    reason = "a test query against the scenario's database, which the offline query cache does not cover"
)]

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use email_e2e::{DEFAULT_TIMEOUT, Mail, Provider, Report, Stack, StackOptions, eventually};
use serde_json::json;

const REPORT: &[u8] = b"%PDF-1.4 the quarterly report";

/// A received attachment becomes one Macro document, created by the real
/// document storage service.
///
/// When it fails: opening an attachment in Macro errors.
async fn received_attachment_becomes_a_document(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await?;
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
    let thread_id = preview["id"].as_str().unwrap_or_default().to_owned();
    let thread = inbox
        .wait_for_thread(&thread_id, "the message to list its attachment", |thread| {
            thread["messages"][0]["attachments"][0]["db_id"].is_string()
        })
        .await?;
    let id = thread["messages"][0]["attachments"][0]["db_id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();

    let first = inbox
        .get(&format!("/email/attachments/{id}/document_id"))
        .await?;
    let second = inbox
        .get(&format!("/email/attachments/{id}/document_id"))
        .await?;
    assert_eq!(first.status, 200, "{}", first.text);
    assert_eq!(second.status, 200, "{}", second.text);
    let document = first.json["document_id"].as_str().unwrap_or_default();
    assert!(!document.is_empty(), "no document id: {}", first.text);
    // Asking again gives the same document, not a second one.
    assert_eq!(first.json["document_id"], second.json["document_id"]);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_received_attachment_becomes_a_document() -> Result<(), Report> {
    received_attachment_becomes_a_document(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_received_attachment_becomes_a_document() -> Result<(), Report> {
    received_attachment_becomes_a_document(Provider::Outlook).await
}

/// The path of the stand-in request that creates a document.
const CREATE_DOCUMENT: &str = "/internal/documents";

/// How many documents the email services have asked document storage for.
fn documents_asked_for(stack: &Stack) -> usize {
    stack
        .service_requests()
        .iter()
        .filter(|request| request.service == "document-storage" && request.path == CREATE_DOCUMENT)
        .count()
}

/// A draft with a PDF attached, as Gmail's own composer stores it.
const DRAFT: &str = concat!(
    "From: ada@example.com\r\n",
    "To: grace@example.com\r\n",
    "Subject: The report\r\n",
    "MIME-Version: 1.0\r\n",
    "Content-Type: multipart/mixed; boundary=\"part\"\r\n",
    "\r\n",
    "--part\r\n",
    "Content-Type: text/plain; charset=utf-8\r\n",
    "\r\n",
    "Attached.\r\n",
    "--part\r\n",
    "Content-Type: application/pdf; name=\"report.pdf\"\r\n",
    "Content-Disposition: attachment; filename=\"report.pdf\"\r\n",
    "Content-Transfer-Encoding: base64\r\n",
    "\r\n",
    "JVBERi0xLjQgdGhlIHF1YXJ0ZXJseSByZXBvcnQ=\r\n",
    "--part--\r\n",
);

/// Saves the draft in Gmail itself, as its composer does, and returns the
/// draft's id: a new draft, or `draft` saved again.
async fn save_in_gmail(stack: &Stack, email: &str, draft: Option<&str>) -> Result<String, Report> {
    let drafts = format!("{}/users/me/drafts", stack.gmail().gmail_url());
    let http = reqwest::Client::new();
    let request = match draft {
        Some(id) => http.put(format!("{drafts}/{id}")),
        None => http.post(drafts),
    };
    let saved = request
        .bearer_auth(stack.gmail().access_token(email)?)
        .json(&json!({ "message": { "raw": URL_SAFE_NO_PAD.encode(DRAFT) } }))
        .send()
        .await?
        .error_for_status()?
        .json::<serde_json::Value>()
        .await?;
    Ok(saved["id"].as_str().unwrap_or_default().to_owned())
}

/// A draft that Gmail drops while one of its attachments is being opened
/// (every save in Gmail replaces the draft's message) answers not found:
/// document storage tells the email service that the attachment is gone.
///
/// When it fails: opening the attachment answers a server error, and the
/// import of a replaced draft's attachment is retried for nothing.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_attachment_of_a_replaced_draft_is_not_found() -> Result<(), Report> {
    let stack = Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;

    // The sync that brings the draft tries to store the attachment and
    // goes on without it, so the first document is the one the user asks for.
    stack.fail_next_service_request("document-storage", "POST", CREATE_DOCUMENT, 503)?;
    let draft = save_in_gmail(&stack, inbox.email(), None).await?;
    let preview = inbox.wait_for_preview("all", "The report").await?;
    let thread = inbox
        .wait_for_thread(
            preview["id"].as_str().unwrap_or_default(),
            "the draft to list its attachment",
            |thread| thread["messages"][0]["attachments"][0]["db_id"].is_string(),
        )
        .await?;
    let id = thread["messages"][0]["attachments"][0]["db_id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    // The request to hold is the one the user's click makes.
    eventually(
        "the sync to have asked for the document",
        DEFAULT_TIMEOUT,
        async || Ok((documents_asked_for(&stack) > 0).then_some(())),
    )
    .await?;

    let mut held = stack.hold_next_service_request("document-storage", "POST", CREATE_DOCUMENT)?;
    let path = format!("/email/attachments/{id}/document_id");
    let (opened, replaced) = tokio::join!(inbox.get(&path), async {
        held.arrived().await?;
        // Saved again in Gmail: the draft's message is replaced by a new one.
        save_in_gmail(&stack, inbox.email(), Some(&draft)).await?;
        let first: uuid::Uuid = id.parse()?;
        eventually(
            "the first revision's attachment to leave Macro",
            DEFAULT_TIMEOUT,
            async || {
                let left: i64 =
                    sqlx::query_scalar("SELECT count(*) FROM email_attachments WHERE id = $1")
                        .bind(first)
                        .fetch_one(stack.db())
                        .await?;
                Ok((left == 0).then_some(()))
            },
        )
        .await?;
        held.release();
        Ok::<(), Report>(())
    });
    replaced?;
    let opened = opened?;
    assert_eq!(opened.status, 404, "{}", opened.text);

    stack.finish().await
}
