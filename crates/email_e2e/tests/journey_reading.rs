//! Reading what arrives: a message with an attachment and an inline image,
//! opened every way the app opens it (the thread, the message on its own,
//! a batch of messages, the original `.eml`), and the read receipt that
//! tells a sender their mail was opened.

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use email_e2e::{Inbox, Provider, Report, Stack, gmail_emulator, outlook_emulator};
use serde_json::{Value, json};

const AGENDA: &[u8] = b"%PDF-1.4 the agenda for the site visit";
/// A 1x1 PNG.
const LOGO: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];
const SUBJECT: &str = "Site visit";
const TEXT: &str = "The agenda is attached; our logo is below.";
const HTML: &str = r#"<html><body><p>The agenda is attached; our logo is below.</p><img src="cid:logo"></body></html>"#;

/// The mail as another client sends it: the text, an HTML body showing an
/// inline image, and an attached file.
fn deliver_site_visit(stack: &Stack, inbox: &Inbox) -> Result<(), Report> {
    match inbox.provider() {
        Provider::Gmail => {
            let raw = [
                "From: Grace <grace@example.com>".to_owned(),
                format!("To: {}", inbox.email()),
                format!("Subject: {SUBJECT}"),
                "Message-ID: <site-visit@example.com>".to_owned(),
                "Date: Fri, 13 Nov 2026 09:00:00 +0000".to_owned(),
                "MIME-Version: 1.0".to_owned(),
                r#"Content-Type: multipart/mixed; boundary="mixed""#.to_owned(),
                String::new(),
                "--mixed".to_owned(),
                r#"Content-Type: multipart/related; boundary="related""#.to_owned(),
                String::new(),
                "--related".to_owned(),
                r#"Content-Type: multipart/alternative; boundary="alt""#.to_owned(),
                String::new(),
                "--alt".to_owned(),
                "Content-Type: text/plain; charset=utf-8".to_owned(),
                String::new(),
                TEXT.to_owned(),
                "--alt".to_owned(),
                "Content-Type: text/html; charset=utf-8".to_owned(),
                String::new(),
                HTML.to_owned(),
                "--alt--".to_owned(),
                "--related".to_owned(),
                "Content-Type: image/png".to_owned(),
                "Content-Transfer-Encoding: base64".to_owned(),
                "Content-ID: <logo>".to_owned(),
                r#"Content-Disposition: inline; filename="logo.png""#.to_owned(),
                String::new(),
                STANDARD.encode(LOGO),
                "--related--".to_owned(),
                "--mixed".to_owned(),
                r#"Content-Type: application/pdf; name="agenda.pdf""#.to_owned(),
                "Content-Transfer-Encoding: base64".to_owned(),
                r#"Content-Disposition: attachment; filename="agenda.pdf""#.to_owned(),
                String::new(),
                STANDARD.encode(AGENDA),
                "--mixed--".to_owned(),
                String::new(),
            ]
            .join("\r\n");
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
                    subject: Some(SUBJECT.to_owned()),
                    text: Some(TEXT.to_owned()),
                    html: Some(HTML.to_owned()),
                    attachments: vec![
                        outlook_emulator::NewAttachment {
                            filename: "logo.png".to_owned(),
                            mime_type: Some("image/png".to_owned()),
                            base64: Some(STANDARD.encode(LOGO)),
                            content_id: Some("logo".to_owned()),
                            ..Default::default()
                        },
                        outlook_emulator::NewAttachment {
                            filename: "agenda.pdf".to_owned(),
                            mime_type: Some("application/pdf".to_owned()),
                            base64: Some(STANDARD.encode(AGENDA)),
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

/// The attachment of `message` named `filename`.
fn attachment<'a>(message: &'a Value, filename: &str) -> Option<&'a Value> {
    message["attachments"]
        .as_array()?
        .iter()
        .find(|attachment| attachment["filename"] == filename)
}

/// A message with a file and an inline image, opened every way the app
/// opens one: the thread lists both, the body shows the image by its
/// content id, both download with the sender's bytes, the message reads
/// the same on its own and in a batch, and the original downloads as an
/// `.eml` with its parts.
///
/// When it fails, the user sees a broken image or a missing file, a
/// download gives other bytes, or "Download original" fails.
async fn read_everything_in_a_message(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    deliver_site_visit(&stack, &inbox)?;

    let preview = inbox.wait_for_preview("inbox", SUBJECT).await?;
    let thread = inbox
        .wait_for_thread(
            preview["id"].as_str().unwrap_or_default(),
            "the message to list its file and its image",
            |thread| {
                attachment(&thread["messages"][0], "agenda.pdf").is_some()
                    && attachment(&thread["messages"][0], "logo.png").is_some()
            },
        )
        .await?;
    let message = &thread["messages"][0];
    let message_id = message["db_id"].as_str().unwrap_or_default().to_owned();
    assert!(
        message["body_text"]
            .as_str()
            .is_some_and(|text| text.contains("agenda is attached")),
        "{message}"
    );
    let html = message["body_html_sanitized"].as_str().unwrap_or_default();
    assert!(html.contains("cid:logo"), "the body lost its image: {html}");

    let logo = attachment(message, "logo.png").cloned().unwrap_or_default();
    assert_eq!(
        logo["content_id"]
            .as_str()
            .map(|id| id.trim_matches(['<', '>'])),
        Some("logo"),
        "the image cannot be placed in the body: {logo}"
    );
    let agenda = attachment(message, "agenda.pdf")
        .cloned()
        .unwrap_or_default();
    for (file, bytes) in [(&agenda, AGENDA), (&logo, LOGO)] {
        let downloaded = inbox
            .download_attachment(file["db_id"].as_str().unwrap_or_default())
            .await?;
        assert_eq!(downloaded.as_ref(), bytes, "{file}");
    }

    // The message on its own (its headers, without the body), and in a
    // batch with its body.
    let single = inbox
        .get(&format!("/email/messages/{message_id}"))
        .await?
        .ok()?;
    assert_eq!(single["db_id"], message_id.as_str(), "{single}");
    assert_eq!(single["subject"], SUBJECT, "{single}");
    assert_eq!(single["thread_db_id"], preview["id"], "{single}");
    assert!(
        single["from"].to_string().contains("grace@example.com"),
        "{single}"
    );
    let batch = inbox
        .post("/email/messages/batch", Some(&json!([message_id])))
        .await?
        .ok()?;
    assert_eq!(batch.as_array().map(Vec::len), Some(1), "{batch}");
    assert_eq!(batch[0]["db_id"], message_id.as_str(), "{batch}");
    assert_eq!(batch[0]["subject"], SUBJECT, "{batch}");
    assert!(
        batch[0]["body_parsed"]
            .to_string()
            .contains("agenda is attached"),
        "the batch read lost the body: {batch}"
    );

    // The original, as the provider holds it.
    let eml = inbox
        .get(&format!("/email/messages/{message_id}/eml"))
        .await?;
    assert_eq!(eml.status, 200, "{}", eml.text);
    assert!(
        eml.text.contains(&format!("Subject: {SUBJECT}")),
        "{}",
        eml.text
    );
    assert!(eml.text.contains("agenda.pdf"), "{}", eml.text);
    assert!(eml.text.contains("Content-ID: <logo>"), "{}", eml.text);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_read_everything_in_a_message() -> Result<(), Report> {
    read_everything_in_a_message(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_read_everything_in_a_message() -> Result<(), Report> {
    read_everything_in_a_message(Provider::Outlook).await
}

/// The text of a raw message with its transfer encodings undone, so a URL
/// in the HTML part can be searched for: quoted-printable soft breaks and
/// escapes are reversed, and every part that decodes as base64 is added
/// decoded.
fn readable(raw: &str) -> String {
    let unfolded = raw
        .replace("=\r\n", "")
        .replace("=\n", "")
        .replace("=3D", "=");
    let mut readable = unfolded.clone();
    for part in unfolded.split("\r\n\r\n").chain(unfolded.split("\n\n")) {
        let compact: String = part
            .lines()
            .take_while(|line| !line.starts_with("--"))
            .collect();
        if let Ok(decoded) = STANDARD.decode(compact.trim())
            && let Ok(text) = String::from_utf8(decoded)
        {
            readable.push_str(&text);
        }
    }
    readable
}

/// The read-receipt token in the original of the message `message_id`, if
/// it carries the tracking image.
async fn receipt_token(recipient: &Inbox, message_id: &str) -> Result<Option<String>, Report> {
    let eml = recipient
        .get(&format!("/email/messages/{message_id}/eml"))
        .await?;
    assert_eq!(eml.status, 200, "{}", eml.text);
    let text = readable(&eml.text);
    Ok(text.split("/opens/").nth(1).map(|rest| {
        rest.chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect()
    }))
}

/// The receipts the sender reads for a thread.
async fn receipts(sender: &Inbox, thread_id: &str) -> Result<Vec<Value>, Report> {
    let answer = sender
        .get(&format!("/email/threads/{thread_id}/read-receipts"))
        .await?
        .ok()?;
    Ok(answer["receipts"].as_array().cloned().unwrap_or_default())
}

/// Receives a mail from the sender and returns its message id in the
/// recipient's Macro.
async fn received_message(recipient: &Inbox, subject: &str) -> Result<String, Report> {
    let preview = recipient.wait_for_preview("inbox", subject).await?;
    let thread = recipient
        .thread(preview["id"].as_str().unwrap_or_default())
        .await?;
    Ok(thread["messages"][0]["db_id"]
        .as_str()
        .unwrap_or_default()
        .to_owned())
}

/// A read receipt, end to end: an HTML mail carries a tracking image, the
/// recipient's client loading it records one open for the sender (a
/// reload within seconds is not a second open), only the sender reads it,
/// and once the sender turns receipts off the next mail carries none.
///
/// When it fails, senders never learn their mail was opened, opens are
/// counted twice, a recipient sees who else opened, or turning receipts off
/// does not stop the tracking.
async fn read_receipt_records_an_open(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let sender = ada.link(provider, ada.email()).await?;
    let recipient = grace.link(provider, grace.email()).await?;

    let send_html = async |subject: &str| -> Result<(), Report> {
        sender
            .send(&json!({
                "subject": subject,
                "to": [{ "email": grace.email() }],
                "body_text": "The proposal is ready.",
                "body_html": URL_SAFE_NO_PAD
                    .encode("<html><body><p>The proposal is ready.</p></body></html>"),
            }))
            .await?;
        Ok(())
    };

    send_html("Proposal").await?;
    let received = received_message(&recipient, "Proposal").await?;
    let token = receipt_token(&recipient, &received)
        .await?
        .ok_or_else(|| rootcause::report!("the mail carries no tracking image"))?;
    assert_eq!(token.len(), 43, "{token}");
    let sent = sender.wait_for_preview("sent", "Proposal").await?;
    let sent_thread = sent["id"].as_str().unwrap_or_default().to_owned();
    let unopened = receipts(&sender, &sent_thread).await?;
    assert_eq!(unopened.len(), 1, "{unopened:?}");
    assert_eq!(
        unopened[0]["open_count"], 0,
        "an open was recorded before anyone opened the mail: {unopened:?}"
    );

    // The recipient's client loads the image, twice in a row.
    let pixel = format!("{}/opens/{token}", stack.api_url());
    for _ in 0..2 {
        let loaded = reqwest::get(&pixel).await?;
        assert_eq!(loaded.status(), 200);
        assert_eq!(
            loaded
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
            Some("image/gif")
        );
    }
    let opened = receipts(&sender, &sent_thread).await?;
    assert_eq!(opened.len(), 1, "{opened:?}");
    assert_eq!(
        opened[0]["open_count"], 1,
        "a reload counted twice: {opened:?}"
    );
    assert!(opened[0]["first_opened_at"].is_string(), "{opened:?}");

    // Only the sender reads them: the recipient asking for the sent thread's
    // receipts gets none.
    let theirs = recipient
        .get(&format!("/email/threads/{sent_thread}/read-receipts"))
        .await?;
    let refused = matches!(theirs.status, 401 | 403 | 404);
    let empty = theirs.status == 200
        && theirs.json["receipts"]
            .as_array()
            .is_some_and(Vec::is_empty);
    assert!(
        refused || empty,
        "the recipient sees the sender's receipts: {} {}",
        theirs.status,
        theirs.text
    );

    // Turned off, the next mail is not tracked.
    let settings = sender
        .patch(
            "/email/settings",
            Some(&json!({ "settings": { "read_receipts_enabled": false } })),
        )
        .await?
        .ok()?;
    assert_eq!(
        settings["settings"]["read_receipts_enabled"], false,
        "{settings}"
    );
    send_html("Proposal, second draft").await?;
    let second = received_message(&recipient, "Proposal, second draft").await?;
    assert_eq!(
        receipt_token(&recipient, &second).await?,
        None,
        "receipts are off but the mail is tracked"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_read_receipt_records_an_open() -> Result<(), Report> {
    read_receipt_records_an_open(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_read_receipt_records_an_open() -> Result<(), Report> {
    read_receipt_records_an_open(Provider::Outlook).await
}
