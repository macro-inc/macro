//! Attachments on drafts and forwards, and what becomes of a received
//! attachment when it is opened: as the recipient's provider is handed them
//! and as the other Macro services are asked to store them.

#[path = "send_support/support.rs"]
mod support;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use email_e2e::{
    DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, ServiceRequest, Stack, eventually,
    gmail_emulator, outlook_emulator,
};
use rootcause::prelude::*;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use support::{html, message_in_thread, provider_copies, wait_for_wire, wire};
use uuid::Uuid;

const REPORT: &[u8] = b"%PDF-1.4 the quarterly report";
const NOTES: &[u8] = b"%PDF-1.4 the meeting notes";
/// A few bytes that start like a PNG: the logo inline in a message body.
const LOGO: &[u8] = b"\x89PNG\r\n\x1a\n the company logo";
/// The `Content-ID` the message body refers to the logo by.
const LOGO_CID: &str = "logo@example.com";
/// The longest document name the document storage service accepts, in
/// graphemes.
const MAX_DOCUMENT_NAME: usize = 200;
/// The stand-in the email services reach the document storage service at.
const DOCUMENT_STORAGE: &str = "document-storage";
/// Where the email services ask it for a document.
const CREATE_DOCUMENT: &str = "/internal/documents";
const INVITE: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//EN\r\nMETHOD:PUBLISH\r\n\
    BEGIN:VEVENT\r\nUID:launch-1@example.com\r\nDTSTAMP:20261101T090000Z\r\n\
    DTSTART:20261120T150000Z\r\nDTEND:20261120T160000Z\r\nSUMMARY:Launch\r\n\
    END:VEVENT\r\nEND:VCALENDAR\r\n";

/// A file of `len` bytes that no compression or accident reproduces.
fn file(len: usize) -> Vec<u8> {
    (0..len).map(|index| (index * 31 % 251) as u8).collect()
}

/// The attachments of the first message of the thread named `subject`, once
/// it lists `count` of them, with the thread's id.
async fn received_attachments(
    inbox: &Inbox,
    subject: &str,
    count: usize,
) -> Result<Vec<Value>, Report> {
    let preview = inbox.wait_for_preview("inbox", subject).await?;
    let thread = inbox
        .wait_for_thread(
            preview["id"].as_str().unwrap_or_default(),
            &format!("the message {subject:?} to list {count} attachment(s)"),
            |thread| {
                thread["messages"][0]["attachments"]
                    .as_array()
                    .is_some_and(|attachments| attachments.len() == count)
            },
        )
        .await?;
    Ok(thread["messages"][0]["attachments"]
        .as_array()
        .cloned()
        .unwrap_or_default())
}

/// The attachment with this file name.
fn named<'a>(attachments: &'a [Value], filename: &str) -> Result<&'a Value, Report> {
    attachments
        .iter()
        .find(|attachment| attachment["filename"] == filename)
        .ok_or_else(|| report!("no attachment named {filename:?} among {attachments:?}"))
}

fn id_of(value: &Value, field: &str) -> Result<String, Report> {
    value[field]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| report!("no {field} in {value}"))
}

/// The requests that asked the document storage service for a document of
/// this attachment.
fn document_imports(stack: &Stack, attachment_id: &str) -> Vec<ServiceRequest> {
    stack
        .service_requests()
        .into_iter()
        .filter(|request| {
            request.service == DOCUMENT_STORAGE
                && request.method == "POST"
                && request.path.starts_with(CREATE_DOCUMENT)
                && request
                    .body
                    .as_ref()
                    .is_some_and(|body| body["emailAttachmentId"] == attachment_id)
        })
        .collect()
}

/// How many objects with exactly these bytes the services stored for the
/// document storage service.
fn stored_documents(stack: &Stack, bytes: &[u8]) -> usize {
    stack
        .stored_objects()
        .iter()
        .filter(|object| object.key.contains(DOCUMENT_STORAGE) && object.bytes.as_ref() == bytes)
        .count()
}

/// The draft as the thread view shows it.
async fn read_draft(inbox: &Inbox, draft: &Value) -> Result<Value, Report> {
    let read = message_in_thread(
        inbox,
        &id_of(draft, "thread_db_id")?,
        &id_of(draft, "db_id")?,
    )
    .await?;
    if read.is_null() {
        bail!("the thread no longer lists the draft {draft}");
    }
    Ok(read)
}

/// The draft input that sends a saved draft as it stands.
fn as_saved(message: &Value, draft: &Value) -> Value {
    let mut message = message.clone();
    message["db_id"] = draft["db_id"].clone();
    message["draft_generation"] = draft["draft_generation"].clone();
    message
}

/// Puts a message in the mailbox that carries a PDF and shows a logo inline
/// in its body, the way a mail client composes one: the body refers to the
/// logo's part by `Content-ID`.
fn deliver_with_inline_logo(stack: &Stack, inbox: &Inbox, subject: &str) -> Result<(), Report> {
    let body =
        format!("<html><body><div>The blueprints.</div><img src=\"cid:{LOGO_CID}\"></body></html>");
    match inbox.provider() {
        Provider::Gmail => {
            let raw = format!(
                "From: Grace <grace@example.com>\n\
                 To: {to}\n\
                 Subject: {subject}\n\
                 Message-ID: <{id}@example.com>\n\
                 MIME-Version: 1.0\n\
                 Content-Type: multipart/mixed; boundary=\"outer-part\"\n\
                 \n\
                 --outer-part\n\
                 Content-Type: multipart/related; boundary=\"body-part\"\n\
                 \n\
                 --body-part\n\
                 Content-Type: text/html; charset=utf-8\n\
                 \n\
                 {body}\n\
                 --body-part\n\
                 Content-Type: image/png; name=\"logo.png\"\n\
                 Content-Disposition: inline; filename=\"logo.png\"\n\
                 Content-ID: <{LOGO_CID}>\n\
                 Content-Transfer-Encoding: base64\n\
                 \n\
                 {logo}\n\
                 --body-part--\n\
                 --outer-part\n\
                 Content-Type: application/pdf; name=\"report.pdf\"\n\
                 Content-Disposition: attachment; filename=\"report.pdf\"\n\
                 Content-Transfer-Encoding: base64\n\
                 \n\
                 {report}\n\
                 --outer-part--\n",
                to = inbox.email(),
                id = Uuid::now_v7(),
                logo = STANDARD.encode(LOGO),
                report = STANDARD.encode(REPORT),
            );
            stack.gmail().deliver(
                inbox.email(),
                &gmail_emulator::NewMessage {
                    raw: Some(raw),
                    ..Default::default()
                },
            )?;
        }
        Provider::Outlook => {
            stack.outlook().deliver(
                inbox.email(),
                &outlook_emulator::NewMessage {
                    from: Some("Grace <grace@example.com>".to_owned()),
                    subject: Some(subject.to_owned()),
                    text: Some("The blueprints.".to_owned()),
                    html: Some(body),
                    attachments: vec![
                        outlook_emulator::NewAttachment {
                            filename: "report.pdf".to_owned(),
                            mime_type: Some("application/pdf".to_owned()),
                            base64: Some(STANDARD.encode(REPORT)),
                            ..Default::default()
                        },
                        outlook_emulator::NewAttachment {
                            filename: "logo.png".to_owned(),
                            mime_type: Some("image/png".to_owned()),
                            base64: Some(STANDARD.encode(LOGO)),
                            content_id: Some(LOGO_CID.to_owned()),
                            ..Default::default()
                        },
                    ],
                    ..Default::default()
                },
            )?;
        }
    }
    Ok(())
}

/// A message forwarded from another of the user's inboxes than the one that
/// received it still carries the original's attachment and its inline
/// image. When this fails, the recipient gets a forward with no PDF, or a
/// body whose `cid:` image points at a part that was never sent.
async fn forward_from_another_inbox_keeps_attachments(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let received_in = ada.link(provider, ada.email()).await?;
    let sent_from = ada.link(provider, "ada.work@example.com").await?;
    let to = grace.link(provider, grace.email()).await?;

    deliver_with_inline_logo(&stack, &received_in, "Blueprints")?;
    let originals = received_attachments(&received_in, "Blueprints", 2).await?;
    let report = named(&originals, "report.pdf")?;
    let logo = named(&originals, "logo.png")?;

    let message = json!({
        "subject": "Fwd: Blueprints",
        "to": [{ "email": grace.email() }],
        "body_text": "See below.",
        "body_html": html(&format!(
            "<html><body><div>See below.</div>\
             <div>The blueprints.</div><img src=\"cid:{LOGO_CID}\"></body></html>"
        )),
    });
    let draft = sent_from.save_draft(&message).await?;
    let draft_id = id_of(&draft, "db_id")?;
    for original in [report, logo] {
        let added = sent_from
            .post(
                &format!(
                    "/email/drafts/{draft_id}/forwarded-attachments?draft_generation={}",
                    draft["draft_generation"]
                ),
                Some(&json!({ "attachment_id": original["db_id"] })),
            )
            .await?
            .ok()
            .context("the other inbox's attachment could not be added to the forward")?;
        assert_eq!(added["attachment_id"], original["db_id"]);
    }
    let listed = read_draft(&sent_from, &draft).await?;
    assert_eq!(
        listed["attachments_forwarded"].as_array().map(Vec::len),
        Some(2),
        "the draft does not list both forwarded files: {listed}"
    );

    sent_from.send(&as_saved(&message, &draft)).await?;

    let (_, received) = wait_for_wire(&stack, &to, "Fwd: Blueprints").await?;
    let pdf = received
        .attachments
        .iter()
        .find(|attachment| attachment.filename == "report.pdf");
    assert_eq!(
        pdf.map(|attachment| attachment.bytes.as_slice()),
        Some(REPORT),
        "the forward arrived without the original's PDF: {:?}",
        received.attachments
    );
    assert!(
        received.html.contains(&format!("cid:{LOGO_CID}")),
        "the forwarded body no longer refers to its image: {}",
        received.html
    );
    let image = received
        .attachments
        .iter()
        .find(|attachment| attachment.content_id.as_deref() == Some(LOGO_CID));
    assert_eq!(
        image.map(|attachment| attachment.bytes.as_slice()),
        Some(LOGO),
        "the image the body refers to was not sent with it: {:?}",
        received.attachments
    );
    assert_eq!(received.attachments.len(), 2, "{:?}", received.attachments);

    stack.finish().await
}

/// An Outlook draft that already holds an attachment at the provider can be
/// edited and sent. Graph reports an attachment larger than its file, so a
/// re-sync that expects the file's exact length takes its own upload for a
/// foreign change: the draft stays in conflict, the edit never reaches
/// Outlook and the send fails.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_draft_holding_an_attachment_is_edited_and_sent() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link_outlook().await?;
    let to = grace.link_outlook().await?;
    let plans = file(300_000);

    let mut message = json!({
        "subject": "Plans attached",
        "to": [{ "email": grace.email() }],
        "body_text": "First version.",
        "body_html": html("<html><body><div>First version.</div></body></html>"),
    });
    let draft = from.save_draft(&message).await?;
    let draft_id = id_of(&draft, "db_id")?;
    let generation = draft["draft_generation"].as_i64().unwrap_or_default();
    from.attach_to_draft(&draft_id, generation, "plans.pdf", &plans)
        .await?;

    // The draft is in Outlook with its file before it is edited.
    let at_provider = eventually(
        "the Outlook draft to hold its attachment",
        DEFAULT_TIMEOUT,
        async || {
            Ok(stack
                .outlook()
                .messages(from.email())?
                .into_iter()
                .find(|message| {
                    message.is_draft
                        && message.subject == "Plans attached"
                        && message.attachments == ["plans.pdf"]
                }))
        },
    )
    .await?;

    message["body_text"] = json!("Second version.");
    message["body_html"] = json!(html("<html><body><div>Second version.</div></body></html>"));
    let edited = from.save_draft(&as_saved(&message, &draft)).await?;
    eventually(
        "the edit to reach the Outlook draft that holds the attachment",
        DEFAULT_TIMEOUT,
        async || {
            let held = wire(&stack, &from, &at_provider.id).await?;
            Ok(held.html.contains("Second version.").then_some(()))
        },
    )
    .await?;

    from.send(&as_saved(&message, &edited)).await?;

    let (_, received) = wait_for_wire(&stack, &to, "Plans attached").await?;
    assert!(
        received.html.contains("Second version."),
        "the recipient got the draft as it was before the edit: {}",
        received.html
    );
    assert_eq!(
        received.attachments.len(),
        1,
        "the attachment was lost or sent twice: {:?}",
        received
            .attachments
            .iter()
            .map(|attachment| &attachment.filename)
            .collect::<Vec<_>>()
    );
    assert_eq!(received.attachments[0].filename, "plans.pdf");
    assert!(
        received.attachments[0].bytes == plans,
        "the attachment arrived with other bytes than were attached"
    );
    assert_eq!(provider_copies(&to, "Plans attached")?.len(), 1);
    assert_eq!(provider_copies(&from, "Plans attached")?.len(), 1);

    stack.finish().await
}

/// An attachment is known to the draft from the moment the composer
/// reserves it under its own id, before the bytes are uploaded: a save
/// during the upload and a repeated reservation both leave one attachment,
/// and the message goes out with exactly one. When the server gives each
/// reservation an id of its own, an autosave during a slow upload stores
/// the file twice.
async fn attachment_reserved_before_its_upload_is_sent_once(
    provider: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;
    let bytes = file(40_000);
    let digest = Sha256::digest(&bytes);

    let mut message = json!({
        "subject": "Slow upload",
        "to": [{ "email": grace.email() }],
        "body_text": "Attaching.",
    });
    let draft = from.save_draft(&message).await?;
    let draft_id = id_of(&draft, "db_id")?;
    let generation = draft["draft_generation"].as_i64().unwrap_or_default();
    let upload_id = Uuid::now_v7().to_string();
    let reservation = json!({
        "upload_id": upload_id,
        "file_name": "slides.pdf",
        "sha": hex::encode(digest),
        "size": bytes.len(),
    });
    let reserve = format!("/email/drafts/{draft_id}/attachments?draft_generation={generation}");

    let reserved = from.post(&reserve, Some(&reservation)).await?.ok()?;
    assert_eq!(
        reserved["attachment_id"], upload_id,
        "the attachment did not get the id the composer reserved it under"
    );
    let pending = read_draft(&from, &draft).await?;
    assert_eq!(
        pending["attachments_draft"].as_array().map(Vec::len),
        Some(1),
        "{pending}"
    );
    assert_eq!(pending["attachments_draft"][0]["id"], upload_id);
    assert_eq!(pending["attachments_draft"][0]["upload_pending"], true);

    // The autosave that runs while the bytes are still on their way, and
    // the composer asking again for the same attachment.
    message["body_text"] = json!("Attaching the slides.");
    let autosaved = from.save_draft(&as_saved(&message, &draft)).await?;
    let again = from.post(&reserve, Some(&reservation)).await?.ok()?;
    assert_eq!(again["attachment_id"], upload_id);

    let (Some(upload_url), Some(content_type)) =
        (again["upload_url"].as_str(), again["content_type"].as_str())
    else {
        bail!("reserving a draft attachment answered {again}");
    };
    let uploaded = reqwest::Client::new()
        .put(upload_url)
        .header("content-type", content_type)
        .header("x-amz-checksum-sha256", STANDARD.encode(digest))
        .body(bytes.clone())
        .send()
        .await
        .context("could not upload the attachment")?;
    assert!(uploaded.status().is_success(), "{}", uploaded.status());
    from.post(
        &format!(
            "/email/drafts/{draft_id}/attachments/{upload_id}/complete?draft_generation={generation}"
        ),
        None,
    )
    .await?
    .ok()?;

    let complete = read_draft(&from, &draft).await?;
    assert_eq!(
        complete["attachments_draft"].as_array().map(Vec::len),
        Some(1),
        "the save during the upload duplicated or dropped the attachment: {complete}"
    );
    assert_eq!(complete["attachments_draft"][0]["upload_pending"], false);

    from.send(&as_saved(&message, &autosaved)).await?;

    let (_, received) = wait_for_wire(&stack, &to, "Slow upload").await?;
    assert_eq!(
        received.attachments.len(),
        1,
        "the message went out with {} attachments",
        received.attachments.len()
    );
    assert_eq!(received.attachments[0].filename, "slides.pdf");
    assert!(received.attachments[0].bytes == bytes);

    stack.finish().await
}

/// A file taken off a draft is not sent with it; the files left on it are.
/// When this fails the recipient gets a file the sender removed.
async fn removed_attachment_is_not_sent(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;

    let message = json!({
        "subject": "One file only",
        "to": [{ "email": grace.email() }],
        "body_text": "Just the report.",
    });
    let draft = from.save_draft(&message).await?;
    let draft_id = id_of(&draft, "db_id")?;
    let generation = draft["draft_generation"].as_i64().unwrap_or_default();
    from.attach_to_draft(&draft_id, generation, "report.pdf", REPORT)
        .await?;
    let notes = from
        .attach_to_draft(&draft_id, generation, "notes.pdf", NOTES)
        .await?;

    let removed = from
        .delete(
            &format!("/email/drafts/{draft_id}/attachments/{notes}?draft_generation={generation}"),
            None,
        )
        .await?;
    assert_eq!(removed.status, 204, "{}", removed.text);
    let left = read_draft(&from, &draft).await?;
    assert_eq!(
        left["attachments_draft"].as_array().map(Vec::len),
        Some(1),
        "{left}"
    );
    assert_eq!(left["attachments_draft"][0]["file_name"], "report.pdf");

    from.send(&as_saved(&message, &draft)).await?;

    let (_, received) = wait_for_wire(&stack, &to, "One file only").await?;
    let names: Vec<&str> = received
        .attachments
        .iter()
        .map(|attachment| attachment.filename.as_str())
        .collect();
    assert_eq!(names, ["report.pdf"], "the removed file was sent anyway");
    assert_eq!(received.attachments[0].bytes, REPORT);

    stack.finish().await
}

/// Opening an attachment whose file name is longer than a document's name
/// may be saves it as a document all the same, under the start of its name
/// and with its extension. When the whole name is sent, the document
/// storage service refuses it every time and the attachment never opens.
async fn long_attachment_name_is_cut_for_its_document(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    // 300 graphemes, one character each, two and three bytes long.
    let stem = format!("{}{}", "é".repeat(150), "報告".repeat(75));
    let filename = format!("{stem}.pdf");

    inbox.deliver(
        &Mail::new("Grace <grace@example.com>", "Long name", "See attached.").with_attachment(
            &filename,
            "application/pdf",
            REPORT,
        ),
    )?;
    let attachments = received_attachments(&inbox, "Long name", 1).await?;
    assert_eq!(
        attachments[0]["filename"], filename,
        "the message does not show the attachment under its own name"
    );
    let attachment_id = id_of(&attachments[0], "db_id")?;

    let opened = inbox
        .get(&format!("/email/attachments/{attachment_id}/document_id"))
        .await?;
    let imports = eventually(
        "the attachment to be handed to document storage",
        DEFAULT_TIMEOUT,
        async || {
            let imports = document_imports(&stack, &attachment_id);
            Ok((!imports.is_empty()).then_some(imports))
        },
    )
    .await?;
    for import in &imports {
        let body = import.body.clone().unwrap_or_default();
        let name = body["documentName"].as_str().unwrap_or_default();
        assert_eq!(
            name.chars().count(),
            MAX_DOCUMENT_NAME,
            "the document name was not cut to what document storage accepts: {name:?}"
        );
        assert!(
            stem.starts_with(name),
            "the document is not named after the start of the file name: {name:?}"
        );
        assert_eq!(body["fileType"], "pdf", "the extension was lost: {body}");
    }
    let opened = opened
        .ok()
        .context("opening the attachment did not answer its document")?;
    assert!(opened["document_id"].is_string(), "{opened}");
    assert!(
        stored_documents(&stack, REPORT) >= 1,
        "the document's bytes never reached storage"
    );

    stack.finish().await
}

/// An attachment whose document exists but whose bytes never reached
/// storage is stored again when it is opened. When an existing document is
/// taken for a complete one, every later open answers a document that says
/// "location is not ready" forever.
async fn unfinished_attachment_document_is_stored_again(provider: Provider) -> Result<(), Report> {
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
    let attachments = received_attachments(&inbox, "The report", 1).await?;
    let attachment_id = id_of(&attachments[0], "db_id")?;
    // Anything the sync itself does with the attachment is over once a
    // later message has been taken in.
    inbox.deliver(&Mail::new("Grace <grace@example.com>", "Later", "Hi."))?;
    inbox.wait_for_preview("inbox", "Later").await?;

    // What an import leaves behind when its upload fails: the document and
    // its link to the attachment, and no bytes.
    let document_id = Uuid::now_v7().to_string();
    sqlx::query(
        r#"INSERT INTO "Document" (id, name, owner, "fileType", uploaded)
           VALUES ($1, 'report', $2, 'pdf', FALSE)"#,
    )
    .bind(&document_id)
    .bind(ada.macro_id())
    .execute(stack.db())
    .await
    .context("could not record the unfinished document")?;
    sqlx::query("INSERT INTO document_email (document_id, email_attachment_id) VALUES ($1, $2)")
        .bind(&document_id)
        .bind(attachment_id.parse::<Uuid>()?)
        .execute(stack.db())
        .await
        .context("could not link the unfinished document to its attachment")?;
    let imports_before = document_imports(&stack, &attachment_id).len();
    let stored_before = stored_documents(&stack, REPORT);

    let opened = inbox
        .get(&format!("/email/attachments/{attachment_id}/document_id"))
        .await?
        .ok()?;

    assert_eq!(
        opened["document_id"], document_id,
        "opening the attachment made another document instead of finishing its own"
    );
    assert!(
        document_imports(&stack, &attachment_id).len() > imports_before,
        "the unfinished document was answered without importing the attachment again"
    );
    assert!(
        stored_documents(&stack, REPORT) > stored_before,
        "the attachment's bytes were not uploaded again"
    );

    stack.finish().await
}

/// A calendar file arrives as an attachment the client can tell is a
/// calendar and can read, and taking the message in does not turn it into a
/// document. The client opens it as an event from these bytes; when the
/// type or the bytes are missing it can only save it as a file.
async fn calendar_attachment_is_readable_and_not_a_document(
    provider: Provider,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    inbox.deliver(
        &Mail::new("Grace <grace@example.com>", "Launch", "Save the date.").with_attachment(
            "launch.ics",
            "text/calendar",
            INVITE.as_bytes(),
        ),
    )?;
    let attachments = received_attachments(&inbox, "Launch", 1).await?;
    let invite = named(&attachments, "launch.ics")?;
    assert!(
        invite["mime_type"]
            .as_str()
            .is_some_and(|mime_type| mime_type.starts_with("text/calendar")),
        "the client cannot tell the attachment is a calendar: {invite}"
    );
    let attachment_id = id_of(invite, "db_id")?;
    let bytes = inbox.download_attachment(&attachment_id).await?;
    assert_eq!(bytes.as_ref(), INVITE.as_bytes());

    // Whatever the sync does with the attachment is over once a later
    // message has been taken in.
    inbox.deliver(&Mail::new("Grace <grace@example.com>", "Later", "Hi."))?;
    inbox.wait_for_preview("inbox", "Later").await?;
    assert!(
        document_imports(&stack, &attachment_id).is_empty(),
        "the calendar file was saved as a document without being opened"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_forward_from_another_inbox_keeps_attachments() -> Result<(), Report> {
    forward_from_another_inbox_keeps_attachments(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_forward_from_another_inbox_keeps_attachments() -> Result<(), Report> {
    forward_from_another_inbox_keeps_attachments(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_attachment_reserved_before_its_upload_is_sent_once() -> Result<(), Report> {
    attachment_reserved_before_its_upload_is_sent_once(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_attachment_reserved_before_its_upload_is_sent_once() -> Result<(), Report> {
    attachment_reserved_before_its_upload_is_sent_once(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_removed_attachment_is_not_sent() -> Result<(), Report> {
    removed_attachment_is_not_sent(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_removed_attachment_is_not_sent() -> Result<(), Report> {
    removed_attachment_is_not_sent(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_long_attachment_name_is_cut_for_its_document() -> Result<(), Report> {
    long_attachment_name_is_cut_for_its_document(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_long_attachment_name_is_cut_for_its_document() -> Result<(), Report> {
    long_attachment_name_is_cut_for_its_document(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_unfinished_attachment_document_is_stored_again() -> Result<(), Report> {
    unfinished_attachment_document_is_stored_again(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_unfinished_attachment_document_is_stored_again() -> Result<(), Report> {
    unfinished_attachment_document_is_stored_again(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_calendar_attachment_is_readable_and_not_a_document() -> Result<(), Report> {
    calendar_attachment_is_readable_and_not_a_document(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_calendar_attachment_is_readable_and_not_a_document() -> Result<(), Report> {
    calendar_attachment_is_readable_and_not_a_document(Provider::Outlook).await
}
