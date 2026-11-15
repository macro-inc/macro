//! Ingestion: a provider message becoming a stored Macro message.

#![expect(
    clippy::disallowed_methods,
    reason = "test support: the scenarios' own reads of the database are not checked against the query cache"
)]

use std::time::Duration;

use email_e2e::gmail_emulator::{self, Fault, Route, SeedMailbox};
use email_e2e::outlook_emulator;
use email_e2e::{DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, StackOptions, eventually};
use serde_json::{Value, json};

/// The smallest PNG there is: one transparent pixel.
const PIXEL_PNG_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/// The addresses a list of contacts names, sorted.
fn addresses(contacts: &Value) -> Vec<String> {
    let mut addresses: Vec<String> = contacts
        .as_array()
        .map(|contacts| {
            contacts
                .iter()
                .filter_map(|contact| contact["email"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    addresses.sort();
    addresses
}

/// The file names a message lists as attachments, sorted.
fn attachment_names(message: &Value) -> Vec<String> {
    let mut names: Vec<String> = message["attachments"]
        .as_array()
        .map(|attachments| {
            attachments
                .iter()
                .filter_map(|attachment| attachment["filename"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// Waits for the thread with this subject and returns it with its messages.
async fn wait_for_thread_named(inbox: &Inbox, view: &str, subject: &str) -> Result<Value, Report> {
    let preview = inbox.wait_for_preview(view, subject).await?;
    inbox
        .wait_for_thread(
            preview["id"].as_str().unwrap_or_default(),
            "the thread to list a message",
            |thread| thread["messages"][0]["db_id"].is_string(),
        )
        .await
}

/// Takes what is on a queue until one message satisfies `wanted`, and
/// returns everything taken.
async fn wait_for_queue_message(
    stack: &Stack,
    queue: &str,
    what: &str,
    wanted: impl Fn(&Value) -> bool,
) -> Result<Vec<Value>, Report> {
    let mut taken = Vec::new();
    eventually(what, DEFAULT_TIMEOUT, async || {
        taken.extend(stack.take_queue_messages(queue).await?);
        Ok(taken.iter().any(&wanted).then_some(()))
    })
    .await?;
    Ok(taken)
}

/// A received message reads back with the sender's name and address, every
/// recipient, the subject, both bodies and its date; a reply sent later is
/// listed after it. When this fails the reader shows the wrong people, a
/// mangled subject or body, or a thread out of order.
async fn received_message_fields_come_through(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let subject = "Señor café – 日本語 ✓";
    let mut first = Mail::new("Grace <grace@example.com>", subject, "Plain first.");
    first.to = Some(format!("Ada <{}>, Alan <alan@example.com>", ada.email()));
    first.cc = Some("Edsger <edsger@example.com>".to_owned());
    first.html = Some("<div><p>Hello <b>wörld</b> – 日本語</p></div>".to_owned());
    first.message_id = Some("first-fields@example.com".to_owned());
    inbox.deliver(&first)?;

    let thread = wait_for_thread_named(&inbox, "inbox", subject).await?;
    let thread_id = thread["db_id"].as_str().unwrap_or_default().to_owned();
    let message = &thread["messages"][0];
    assert_eq!(message["subject"], subject);
    assert_eq!(message["from"]["email"], "grace@example.com");
    assert_eq!(message["from"]["name"], "Grace");
    assert_eq!(
        addresses(&message["to"]),
        ["ada@example.com", "alan@example.com"]
    );
    let alan = message["to"]
        .as_array()
        .and_then(|to| to.iter().find(|c| c["email"] == "alan@example.com"));
    assert_eq!(alan.map(|alan| &alan["name"]), Some(&Value::from("Alan")));
    assert_eq!(addresses(&message["cc"]), ["edsger@example.com"]);
    assert_eq!(message["cc"][0]["name"], "Edsger");
    assert_eq!(addresses(&message["bcc"]), Vec::<String>::new());
    let html = message["body_html_sanitized"].as_str().unwrap_or_default();
    assert!(
        html.contains("Hello <b>wörld</b> – 日本語"),
        "the HTML body was {html:?}"
    );
    let text = message["body_text"].as_str().unwrap_or_default();
    match provider {
        // Gmail hands over the text part as the sender wrote it.
        Provider::Gmail => assert_eq!(text, "Plain first."),
        // Graph hands over one body; the text is derived from the HTML.
        Provider::Outlook => assert!(text.contains("wörld"), "the text body was {text:?}"),
    }
    assert_eq!(message["is_read"], false);
    assert_eq!(message["is_sent"], false);
    assert_eq!(message["is_draft"], false);
    assert_eq!(message["has_attachments"], false);

    // The preview shows the same sender and subject.
    let preview = inbox.wait_for_preview("inbox", subject).await?;
    assert_eq!(preview["senderEmail"], "grace@example.com");
    assert_eq!(preview["senderName"], "Grace");

    // A later reply is listed after the first message, by date.
    let a_minute = Duration::from_secs(60);
    match provider {
        Provider::Gmail => stack.gmail().advance_clock(a_minute),
        Provider::Outlook => stack.outlook().advance_clock(a_minute),
    }
    let reply = Mail::new(
        "Alan <alan@example.com>",
        &format!("Re: {subject}"),
        "Plain second.",
    )
    .in_reply_to("first-fields@example.com");
    inbox.deliver(&reply)?;
    let thread = inbox
        .wait_for_thread(&thread_id, "the reply to join the thread", |thread| {
            thread["messages"][1]["db_id"].is_string()
        })
        .await?;
    let messages = thread["messages"].as_array().cloned().unwrap_or_default();
    assert_eq!(messages.len(), 2);
    // The API lists a thread's messages newest first.
    assert_eq!(messages[0]["from"]["email"], "alan@example.com");
    assert_eq!(messages[1]["from"]["email"], "grace@example.com");
    let dates: Vec<&str> = messages
        .iter()
        .map(|message| message["internal_date_ts"].as_str().unwrap_or_default())
        .collect();
    assert!(
        !dates[1].is_empty() && dates[0] > dates[1],
        "the messages are dated {dates:?}"
    );
    let preview = inbox
        .wait_for_preview_where("inbox", "the thread sorted by its reply", |preview| {
            preview["id"] == thread_id.as_str() && preview["senderEmail"] == "alan@example.com"
        })
        .await?;
    assert_eq!(
        preview["sortTs"].as_str().map(|ts| ts.get(..19)),
        Some(dates[0].get(..19))
    );

    stack.finish().await
}

/// A message with only an HTML body and one with only a text body both read
/// back with that body. When this fails such mail opens empty.
async fn single_body_messages_read_back(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Text only",
        "Only words here.\nSecond line.",
    ))?;
    let html_only = "<p>Only <em>markup</em> here.</p>";
    match provider {
        Provider::Gmail => {
            stack.gmail().deliver(
                inbox.email(),
                &gmail_emulator::NewMessage {
                    from: Some("Grace <grace@example.com>".to_owned()),
                    subject: Some("HTML only".to_owned()),
                    html: Some(html_only.to_owned()),
                    ..Default::default()
                },
            )?;
        }
        Provider::Outlook => {
            stack.outlook().deliver(
                inbox.email(),
                &outlook_emulator::NewMessage {
                    from: Some("Grace <grace@example.com>".to_owned()),
                    subject: Some("HTML only".to_owned()),
                    html: Some(html_only.to_owned()),
                    ..Default::default()
                },
            )?;
        }
    }

    let text_thread = wait_for_thread_named(&inbox, "inbox", "Text only").await?;
    let text_message = &text_thread["messages"][0];
    let text = text_message["body_text"].as_str().unwrap_or_default();
    assert!(
        text.contains("Only words here.") && text.contains("Second line."),
        "the text-only message's text body was {text:?}"
    );
    assert!(
        !text_message["body_html_sanitized"]
            .as_str()
            .unwrap_or_default()
            .contains("<em>"),
        "the text-only message has the other message's markup"
    );

    let html_thread = wait_for_thread_named(&inbox, "inbox", "HTML only").await?;
    let html = html_thread["messages"][0]["body_html_sanitized"]
        .as_str()
        .unwrap_or_default();
    assert!(
        html.contains("Only <em>markup</em> here."),
        "the HTML-only message's HTML body was {html:?}"
    );

    stack.finish().await
}

/// A message to many people lists every one of them, in To and in Cc. When
/// this fails recipients are missing from the message and from Reply all.
async fn every_recipient_is_listed(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let to: Vec<String> = (1..=6).map(|n| format!("to{n}@example.com")).collect();
    let cc: Vec<String> = (1..=4).map(|n| format!("cc{n}@example.com")).collect();
    let mut mail = Mail::new("Grace <grace@example.com>", "To everyone", "Hello all.");
    mail.to = Some(
        to.iter()
            .map(|address| format!("Person {address} <{address}>"))
            .chain([ada.email().to_owned()])
            .collect::<Vec<_>>()
            .join(", "),
    );
    mail.cc = Some(cc.join(", "));
    inbox.deliver(&mail)?;

    let thread = wait_for_thread_named(&inbox, "inbox", "To everyone").await?;
    let message = &thread["messages"][0];
    let mut expected_to = to.clone();
    expected_to.push(ada.email().to_owned());
    expected_to.sort();
    assert_eq!(addresses(&message["to"]), expected_to);
    assert_eq!(addresses(&message["cc"]), cc);

    stack.finish().await
}

/// A message with an inline image and one with several attachments list
/// them, the inline one with its content id. When this fails attachments
/// are missing from a message, or an inline image shows as a broken link.
async fn attachments_are_listed(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    inbox.deliver(
        &Mail::new("Grace <grace@example.com>", "Three files", "See attached.")
            .with_attachment("one.pdf", "application/pdf", b"%PDF-1.4 one")
            .with_attachment("two.txt", "text/plain", b"two")
            .with_attachment("three.csv", "text/csv", b"a,b\n1,2\n"),
    )?;
    let inline_html = "<p>Look: <img src=\"cid:pixel@example.com\"></p>";
    match provider {
        Provider::Gmail => {
            let raw = format!(
                "From: Grace <grace@example.com>\r\n\
                 To: {to}\r\n\
                 Subject: Inline image\r\n\
                 Message-ID: <inline-image@example.com>\r\n\
                 MIME-Version: 1.0\r\n\
                 Content-Type: multipart/related; boundary=\"rel\"\r\n\
                 \r\n\
                 --rel\r\n\
                 Content-Type: text/html; charset=utf-8\r\n\
                 \r\n\
                 {inline_html}\r\n\
                 --rel\r\n\
                 Content-Type: image/png; name=\"pixel.png\"\r\n\
                 Content-Disposition: inline; filename=\"pixel.png\"\r\n\
                 Content-ID: <pixel@example.com>\r\n\
                 Content-Transfer-Encoding: base64\r\n\
                 \r\n\
                 {PIXEL_PNG_BASE64}\r\n\
                 --rel--\r\n",
                to = inbox.email(),
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
                    subject: Some("Inline image".to_owned()),
                    html: Some(inline_html.to_owned()),
                    attachments: vec![outlook_emulator::NewAttachment {
                        filename: "pixel.png".to_owned(),
                        mime_type: Some("image/png".to_owned()),
                        base64: Some(PIXEL_PNG_BASE64.to_owned()),
                        content_id: Some("pixel@example.com".to_owned()),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            )?;
        }
    }

    let preview = inbox.wait_for_preview("inbox", "Three files").await?;
    let thread = inbox
        .wait_for_thread(
            preview["id"].as_str().unwrap_or_default(),
            "the message to list its three attachments",
            |thread| thread["messages"][0]["attachments"][2]["db_id"].is_string(),
        )
        .await?;
    let message = &thread["messages"][0];
    assert_eq!(
        attachment_names(message),
        ["one.pdf", "three.csv", "two.txt"]
    );
    assert_eq!(message["has_attachments"], true);
    let pdf = message["attachments"]
        .as_array()
        .and_then(|attachments| attachments.iter().find(|a| a["filename"] == "one.pdf"))
        .cloned()
        .unwrap_or_default();
    assert_eq!(pdf["mime_type"], "application/pdf");
    // The size is the provider's figure: Gmail reports the file's length,
    // Graph a little more than it.
    let size = pdf["size_bytes"].as_u64().unwrap_or_default();
    assert!(
        size >= 12,
        "the attachment's size is {size}, the file has 12 bytes"
    );

    let preview = inbox.wait_for_preview("inbox", "Inline image").await?;
    let thread = inbox
        .wait_for_thread(
            preview["id"].as_str().unwrap_or_default(),
            "the message to list its inline image",
            |thread| thread["messages"][0]["attachments"][0]["db_id"].is_string(),
        )
        .await?;
    let message = &thread["messages"][0];
    assert_eq!(attachment_names(message), ["pixel.png"]);
    let image = &message["attachments"][0];
    assert_eq!(image["mime_type"], "image/png");
    let content_id = image["content_id"].as_str().unwrap_or_default();
    assert!(
        content_id.contains("pixel@example.com"),
        "the inline image's content id was {content_id:?}"
    );
    let html = message["body_html_sanitized"].as_str().unwrap_or_default();
    assert!(
        html.contains("<img"),
        "the HTML body lost its image: {html:?}"
    );

    stack.finish().await
}

/// A message whose body is a megabyte of text is stored whole. When this
/// fails long mail (logs, reports, long threads quoted in full) is missing
/// or cut short.
async fn very_large_body_is_stored(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let line = "All work and no play makes Jack a dull boy. 0123456789 abcdefghij\n";
    let body = format!("{}THE END", line.repeat(1024 * 1024 / line.len()));
    assert!(body.len() > 1_000_000);
    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "A long read",
        &body,
    ))?;

    let thread = wait_for_thread_named(&inbox, "inbox", "A long read").await?;
    let text = thread["messages"][0]["body_text"]
        .as_str()
        .unwrap_or_default();
    assert!(
        text.len() >= body.len() - 1024,
        "the stored body has {} of {} bytes",
        text.len(),
        body.len()
    );
    assert!(text.starts_with("All work and no play"));
    assert!(text.trim_end().ends_with("THE END"));

    stack.finish().await
}

/// The HTML body the API serves has no script and no event handler, while
/// the harmless markup around them stays. When this fails a sender can run
/// code in the reader's session.
async fn html_body_is_sanitized(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let mut mail = Mail::new("Mallory <mallory@example.com>", "Click me", "Click me.");
    mail.html = Some(
        "<div><p>Hello <b>reader</b></p>\
         <script>document.title = 'stolen'</script>\
         <img src=\"https://example.com/x.png\" onerror=\"alert(1)\">\
         <a href=\"javascript:alert(2)\" onclick=\"alert(3)\">a link</a>\
         <iframe src=\"https://example.com/frame\"></iframe></div>"
            .to_owned(),
    );
    inbox.deliver(&mail)?;

    let thread = wait_for_thread_named(&inbox, "inbox", "Click me").await?;
    let message = &thread["messages"][0];
    for field in ["body_html_sanitized", "body_replyless"] {
        let html = message[field].as_str().unwrap_or_default();
        assert!(html.contains("Hello <b>reader</b>"), "{field} was {html:?}");
        assert!(html.contains("a link"), "{field} was {html:?}");
        for dangerous in [
            "<script",
            "stolen",
            "onerror",
            "onclick",
            "javascript:",
            "<iframe",
        ] {
            assert!(
                !html.to_lowercase().contains(dangerous),
                "{field} still has {dangerous:?}: {html:?}"
            );
        }
    }

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_received_message_fields_come_through() -> Result<(), Report> {
    received_message_fields_come_through(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_received_message_fields_come_through() -> Result<(), Report> {
    received_message_fields_come_through(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_single_body_messages_read_back() -> Result<(), Report> {
    single_body_messages_read_back(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_single_body_messages_read_back() -> Result<(), Report> {
    single_body_messages_read_back(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_every_recipient_is_listed() -> Result<(), Report> {
    every_recipient_is_listed(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_every_recipient_is_listed() -> Result<(), Report> {
    every_recipient_is_listed(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_attachments_are_listed() -> Result<(), Report> {
    attachments_are_listed(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_attachments_are_listed() -> Result<(), Report> {
    attachments_are_listed(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_very_large_body_is_stored() -> Result<(), Report> {
    very_large_body_is_stored(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_very_large_body_is_stored() -> Result<(), Report> {
    very_large_body_is_stored(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_html_body_is_sanitized() -> Result<(), Report> {
    html_body_is_sanitized(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_html_body_is_sanitized() -> Result<(), Report> {
    html_body_is_sanitized(Provider::Outlook).await
}

// -- ingest-misdeclared-charset --

/// A Gmail part that declares windows-1252 but carries UTF-8 bytes reads
/// back as the sender wrote it, and a part that really is windows-1252 is
/// still decoded as such. When this fails accents, dashes and non-Latin
/// text in such mail show as mojibake ("CafÃ©").
#[tokio::test(flavor = "multi_thread")]
async fn gmail_misdeclared_charset_keeps_utf8_text() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;

    let written = "Café – naïve • 日本語";
    let raw = format!(
        "From: Grace <grace@example.com>\r\n\
         To: {to}\r\n\
         Subject: Misdeclared charset\r\n\
         Message-ID: <misdeclared-charset@example.com>\r\n\
         MIME-Version: 1.0\r\n\
         Content-Type: multipart/alternative; boundary=\"alt\"\r\n\
         \r\n\
         --alt\r\n\
         Content-Type: text/plain; charset=\"iso-8859-1\"\r\n\
         Content-Transfer-Encoding: 8bit\r\n\
         \r\n\
         Text: {written}\r\n\
         --alt\r\n\
         Content-Type: text/html; charset=windows-1252\r\n\
         Content-Transfer-Encoding: 8bit\r\n\
         \r\n\
         <p>Html: {written}</p>\r\n\
         --alt--\r\n",
        to = inbox.email(),
    );
    stack.gmail().deliver(
        inbox.email(),
        &gmail_emulator::NewMessage {
            raw: Some(raw),
            ..Default::default()
        },
    )?;
    // "Café" in real windows-1252: the é is the single byte 0xE9, here in
    // quoted-printable so that the message stays text.
    let raw = format!(
        "From: Grace <grace@example.com>\r\n\
         To: {to}\r\n\
         Subject: Declared charset\r\n\
         Message-ID: <declared-charset@example.com>\r\n\
         MIME-Version: 1.0\r\n\
         Content-Type: text/plain; charset=windows-1252\r\n\
         Content-Transfer-Encoding: quoted-printable\r\n\
         \r\n\
         Caf=E9 =96 na=EFve\r\n",
        to = inbox.email(),
    );
    stack.gmail().deliver(
        inbox.email(),
        &gmail_emulator::NewMessage {
            raw: Some(raw),
            ..Default::default()
        },
    )?;

    let thread = wait_for_thread_named(&inbox, "inbox", "Misdeclared charset").await?;
    let message = &thread["messages"][0];
    let text = message["body_text"].as_str().unwrap_or_default();
    let html = message["body_html_sanitized"].as_str().unwrap_or_default();
    assert!(
        text.contains(&format!("Text: {written}")),
        "the text body was {text:?}"
    );
    assert!(
        html.contains(&format!("Html: {written}")),
        "the HTML body was {html:?}"
    );
    assert!(!text.contains('Ã') && !html.contains('Ã'));

    let thread = wait_for_thread_named(&inbox, "inbox", "Declared charset").await?;
    let text = thread["messages"][0]["body_text"]
        .as_str()
        .unwrap_or_default();
    assert!(text.contains("Café – naïve"), "the text body was {text:?}");

    stack.finish().await
}

// -- ingest-oversized-header-wedges-message --

/// A display name longer than its column.
const OVERSIZED_NAME_LENGTH: usize = 300;
/// What `email_contacts.name` and `email_messages.from_name` hold.
const STORED_NAME_LENGTH: usize = 255;

/// A whole message whose sender's display name, subject and message id are
/// far longer than usual, and whose Cc names an address longer than any
/// real one.
fn oversized_message(to: &str, marker: &str) -> (String, String) {
    let name = "N".repeat(OVERSIZED_NAME_LENGTH);
    let subject = format!("{marker} {}", "S".repeat(2000));
    let message_id = format!("{}@example.com", "m".repeat(600));
    let endless_address = format!("{}@example.com", "c".repeat(330));
    let raw = format!(
        "From: \"{name}\" <grace@example.com>\r\n\
         To: {to}\r\n\
         Cc: {endless_address}, Alan <alan@example.com>\r\n\
         Subject: {subject}\r\n\
         Message-ID: <{marker}-{message_id}>\r\n\
         MIME-Version: 1.0\r\n\
         Content-Type: text/plain; charset=utf-8\r\n\
         \r\n\
         The body of {marker}.\r\n"
    );
    (raw, subject)
}

/// What a stored oversized message must look like.
fn assert_oversized_message_stored(thread: &Value, marker: &str) {
    let message = &thread["messages"][0];
    let name = message["from"]["name"].as_str().unwrap_or_default();
    assert_eq!(message["from"]["email"], "grace@example.com");
    assert_eq!(
        name,
        "N".repeat(STORED_NAME_LENGTH),
        "the sender's name is not the first {STORED_NAME_LENGTH} characters of the header's"
    );
    let text = message["body_text"].as_str().unwrap_or_default();
    assert!(text.contains(&format!("The body of {marker}.")));
    // The address no column can hold is left out; the one next to it stays.
    assert_eq!(addresses(&message["cc"]), ["alan@example.com"]);
}

/// A message with an overlong sender name, subject, message id and Cc
/// address that arrives in a synced inbox is stored, with the name cut to
/// what its column holds. When this fails the message never shows and its
/// queue message is retried until it is dead-lettered.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_oversized_headers_do_not_block_a_new_message() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;

    let (raw, subject) = oversized_message(inbox.email(), "live");
    stack.gmail().deliver(
        inbox.email(),
        &gmail_emulator::NewMessage {
            raw: Some(raw),
            ..Default::default()
        },
    )?;

    let thread = wait_for_thread_named(&inbox, "inbox", &subject).await?;
    assert_oversized_message_stored(&thread, "live");
    assert_eq!(stack.dead_letters("gmail-inbox-sync").await?, 0);

    stack.finish().await
}

/// A mailbox that already holds such a message finishes its first sync with
/// the message stored, next to an ordinary one. When this fails the inbox
/// stays "syncing" forever, or finishes without the message.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_oversized_headers_do_not_block_the_first_sync() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let (raw, subject) = oversized_message(ada.email(), "backfill");
    stack.gmail().add_mailbox(&SeedMailbox {
        email: ada.email().to_owned(),
        messages: vec![
            gmail_emulator::NewMessage {
                from: Some("Alan <alan@example.com>".to_owned()),
                subject: Some("An ordinary message".to_owned()),
                text: Some("Nothing special.".to_owned()),
                ..Default::default()
            },
            gmail_emulator::NewMessage {
                raw: Some(raw),
                ..Default::default()
            },
        ],
        ..Default::default()
    })?;

    // Returns once the API reports the first sync complete.
    let inbox = ada.link_gmail().await?;

    let thread = wait_for_thread_named(&inbox, "inbox", &subject).await?;
    assert_oversized_message_stored(&thread, "backfill");
    inbox
        .wait_for_preview("inbox", "An ordinary message")
        .await?;
    assert_eq!(stack.dead_letters("backfill").await?, 0);

    stack.finish().await
}

// -- ingest-address-rejected-by-user-id-parser --

/// An address mail systems accept and Macro's user-id parser does not: its
/// local part is not ASCII.
const ODD_ADDRESS: &str = "josé.núñez@example.com";

/// Mail from an address that cannot be a Macro user id is stored and
/// announced like any other: the client is told to refresh and the
/// new-mail notification is sent. When this fails such mail arrives
/// silently: stored, but nothing tells the user or the open app.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_mail_from_an_odd_address_is_still_announced() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;

    inbox.deliver(&Mail::new(
        &format!("José <{ODD_ADDRESS}>"),
        "From an odd address",
        "Hola.",
    ))?;
    let thread = wait_for_thread_named(&inbox, "inbox", "From an odd address").await?;
    let thread_id = thread["db_id"].as_str().unwrap_or_default().to_owned();
    assert_eq!(thread["messages"][0]["from"]["email"], ODD_ADDRESS);
    assert_eq!(thread["messages"][0]["from"]["name"], "José");

    // The steps after contact sync still ran.
    wait_for_queue_message(
        &stack,
        "notification-ingress",
        "the new-mail notification for the message from the odd address",
        |notification| {
            notification["request"]["req"]["notification"]["content"]["threadId"]
                == thread_id.as_str()
        },
    )
    .await?;
    eventually(
        "the client to be told to refresh the inbox",
        DEFAULT_TIMEOUT,
        async || {
            let told = stack.service_requests().iter().any(|request| {
                request.service == "connection-gateway"
                    && request.body.as_ref().is_some_and(|body| {
                        body["message"]["event"] == "upsert_message"
                            && body["message"]["link_id"] == inbox.link_id().to_string().as_str()
                    })
            });
            Ok(told.then_some(()))
        },
    )
    .await?;
    assert_eq!(stack.dead_letters("gmail-inbox-sync").await?, 0);

    stack.finish().await
}

/// Mail the user sent to an odd address and to ordinary ones still connects
/// the user to the ordinary ones. When this fails one odd recipient costs
/// the user every contact of that message.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_odd_recipient_does_not_cost_the_other_contacts() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;

    stack.gmail().deliver(
        inbox.email(),
        &gmail_emulator::NewMessage {
            from: Some(format!("Ada <{}>", inbox.email())),
            to: Some(format!(
                "José <{ODD_ADDRESS}>, Alan <alan@example.com>, Edsger <edsger@example.com>"
            )),
            subject: Some("To an odd address".to_owned()),
            text: Some("Hello all.".to_owned()),
            labels: Some(vec!["SENT".to_owned()]),
            ..Default::default()
        },
    )?;
    let thread = wait_for_thread_named(&inbox, "sent", "To an odd address").await?;
    assert_eq!(
        addresses(&thread["messages"][0]["to"]),
        ["alan@example.com", "edsger@example.com", ODD_ADDRESS]
    );

    let connected = |queued: &[Value], address: &str| {
        queued.iter().any(|message| {
            message["connections"]
                .as_array()
                .is_some_and(|connections| {
                    connections.iter().any(|connection| {
                        connection["first"] == ada.macro_id()
                            && connection["second"] == format!("macro|{address}").as_str()
                    })
                })
        })
    };
    let queued = wait_for_queue_message(
        &stack,
        "contacts",
        "the contacts of the sent message to be queued",
        |message| connected(std::slice::from_ref(message), "alan@example.com"),
    )
    .await?;
    assert!(
        connected(&queued, "edsger@example.com"),
        "queued: {queued:?}"
    );
    assert!(!connected(&queued, ODD_ADDRESS), "queued: {queued:?}");

    stack.finish().await
}

/// An attachment on mail that names an odd address still gets its document
/// properties: where it came from, and the people of the message that can
/// be Macro users. When this fails the attachment's document has no source
/// thread, sender or recipients, and never gets them.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_attachment_keeps_its_properties_next_to_an_odd_address() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;

    let mut mail = Mail::new(
        "Grace <grace@example.com>",
        "A file for odd people",
        "See attached.",
    )
    .with_attachment("report.pdf", "application/pdf", b"%PDF-1.4 report");
    mail.to = Some(format!(
        "{}, José <{ODD_ADDRESS}>, Alan <alan@example.com>",
        inbox.email()
    ));
    inbox.deliver(&mail)?;
    let thread = wait_for_thread_named(&inbox, "inbox", "A file for odd people").await?;
    let thread_id = thread["db_id"].as_str().unwrap_or_default().to_owned();

    // The document the attachment became, as document storage was asked for it.
    let document_id = eventually(
        "the attachment to be uploaded as a document",
        DEFAULT_TIMEOUT,
        async || {
            Ok(stack.stored_objects().iter().find_map(|object| {
                object
                    .key
                    .strip_prefix("document-storage/")
                    .map(str::to_owned)
            }))
        },
    )
    .await?;
    let asked = stack.service_requests();
    assert!(
        asked
            .iter()
            .any(|request| request.service == "document-storage"
                && request
                    .body
                    .as_ref()
                    .is_some_and(|body| body["documentName"] == "report")),
        "document storage was asked: {asked:?}"
    );

    let wanted = [
        thread_id.as_str(),
        "macro|grace@example.com",
        "macro|alan@example.com",
    ];
    let properties = eventually(
        "the attachment's document to name its thread, sender and ordinary recipient",
        DEFAULT_TIMEOUT,
        async || {
            let values: Vec<String> = sqlx::query_scalar(
                "SELECT values::text FROM entity_properties WHERE entity_id = $1",
            )
            .bind(&document_id)
            .fetch_all(stack.db())
            .await?;
            let properties = values.join("\n");
            let complete = wanted.iter().all(|value| properties.contains(value));
            Ok(complete.then_some(properties))
        },
    )
    .await?;
    assert!(!properties.contains("josé"), "properties: {properties}");

    stack.finish().await
}

/// Outlook: mail from an odd address, and mail sent to one next to ordinary
/// addresses, is stored, and the ordinary correspondents still become
/// contacts. When this fails such mail is missing or costs the user the
/// contacts of everyone else on it.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_odd_addresses_do_not_cost_the_message_or_other_contacts() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_outlook().await?;

    inbox.deliver(&Mail::new(
        &format!("José <{ODD_ADDRESS}>"),
        "From an odd address",
        "Hola.",
    ))?;
    stack.outlook().deliver(
        inbox.email(),
        &outlook_emulator::NewMessage {
            to: Some(format!(
                "José <{ODD_ADDRESS}>, Alan <alan@example.com>, Edsger <edsger@example.com>"
            )),
            subject: Some("To an odd address".to_owned()),
            text: Some("Hello all.".to_owned()),
            folder: Some("sentitems".to_owned()),
            ..Default::default()
        },
    )?;

    let thread = wait_for_thread_named(&inbox, "inbox", "From an odd address").await?;
    assert_eq!(thread["messages"][0]["from"]["email"], ODD_ADDRESS);
    let thread = wait_for_thread_named(&inbox, "sent", "To an odd address").await?;
    assert_eq!(
        addresses(&thread["messages"][0]["to"]),
        ["alan@example.com", "edsger@example.com", ODD_ADDRESS]
    );

    let mut queued = Vec::new();
    eventually(
        "both ordinary recipients of the sent message to be queued as contacts",
        DEFAULT_TIMEOUT,
        async || {
            queued.extend(stack.take_queue_messages("contacts").await?);
            let both = connects(&queued, ada.macro_id(), "alan@example.com")
                && connects(&queued, ada.macro_id(), "edsger@example.com");
            Ok(both.then_some(()))
        },
    )
    .await?;
    assert!(
        !connects(&queued, ada.macro_id(), ODD_ADDRESS),
        "queued: {queued:?}"
    );

    stack.finish().await
}

/// Whether a message taken from the `contacts` queue connects the user to
/// this address.
fn connects(queued: &[Value], user: &str, address: &str) -> bool {
    queued.iter().any(|message| {
        message["connections"]
            .as_array()
            .is_some_and(|connections| {
                connections.iter().any(|connection| {
                    connection["first"] == user
                        && connection["second"] == format!("macro|{address}").as_str()
                })
            })
    })
}

// -- ingest-unknown-label-fails-message --

/// A message that carries a label the user made a moment ago, which the
/// inbox has not synced yet, is stored anyway and gets the label once the
/// labels are synced. When this fails such a message never shows: its
/// insert fails on the label every time it is retried.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_message_with_a_label_not_synced_yet_is_stored() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;
    let gmail = stack.gmail();
    let email = inbox.email();

    // The sync of a notification reads the labels, then the history, then
    // each message. Holding the history answer back leaves time to label
    // the message after the labels were read and before the message is.
    let label_reads = || {
        gmail
            .requests()
            .iter()
            .filter(|request| {
                request.route == Some(Route::LabelsList)
                    && request.mailbox.as_deref() == Some(email)
            })
            .count()
    };
    let label_reads_before = label_reads();
    gmail.inject_fault(Fault {
        mailbox: Some(email.to_owned()),
        route: Some(Route::HistoryList),
        delay_ms: Some(5000),
        times: Some(1),
        ..Default::default()
    });
    let delivered = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Freshly labelled",
        "Filed on arrival.",
    ))?;
    eventually(
        "the sync of the new message to read the labels",
        DEFAULT_TIMEOUT,
        async || Ok((label_reads() > label_reads_before).then_some(())),
    )
    .await?;

    // No notification for what follows: the sync under way must meet the
    // label unprepared.
    let push = gmail.push_config();
    gmail.set_push(None);
    let created = reqwest::Client::new()
        .post(format!("{}/users/me/labels", gmail.gmail_url()))
        .bearer_auth(gmail.access_token(email)?)
        .json(&json!({ "name": "Receipts" }))
        .send()
        .await?;
    assert!(
        created.status().is_success(),
        "creating a label answered {}",
        created.status()
    );
    let created: Value = created.json().await?;
    let label_id = created["id"].as_str().unwrap_or_default().to_owned();
    assert!(!label_id.is_empty(), "the new label is {created}");
    gmail.modify_labels(email, &delivered.id, std::slice::from_ref(&label_id), &[])?;

    let thread = wait_for_thread_named(&inbox, "inbox", "Freshly labelled").await?;
    let thread_id = thread["db_id"].as_str().unwrap_or_default().to_owned();
    assert_eq!(thread["messages"][0]["from"]["email"], "grace@example.com");
    assert_eq!(stack.dead_letters("gmail-inbox-sync").await?, 0);

    // The next notification syncs the label and puts it on the message.
    gmail.set_push(push);
    gmail.push_now(email)?;
    inbox
        .wait_for_thread(&thread_id, "the message to carry the new label", |thread| {
            thread["messages"][0]["labels"]
                .as_array()
                .is_some_and(|labels| {
                    labels.iter().any(|label| {
                        label["provider_label_id"] == label_id.as_str()
                            && label["name"] == "Receipts"
                    })
                })
        })
        .await?;

    stack.finish().await
}

// -- scenario-held locks --

/// How many of the services' database sessions wait for a row lock.
async fn lock_waiters(stack: &Stack) -> Result<i64, Report> {
    let waiting: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_stat_activity \
         WHERE datname = current_database() AND wait_event_type = 'Lock'",
    )
    .fetch_one(stack.db())
    .await?;
    Ok(waiting)
}

/// Waits until this many of the services' database sessions wait for a row
/// the scenario holds.
async fn wait_for_lock_waiters(stack: &Stack, what: &str, wanted: i64) -> Result<(), Report> {
    eventually(what, DEFAULT_TIMEOUT, async || {
        Ok((lock_waiters(stack).await? >= wanted).then_some(()))
    })
    .await
}

/// Asserts the workers never ran into a deadlock or a lock timeout.
async fn assert_no_lock_failures(stack: &Stack) -> Result<(), Report> {
    let deadlocks: i64 = sqlx::query_scalar(
        "SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()",
    )
    .fetch_one(stack.db())
    .await?;
    assert_eq!(deadlocks, 0, "the database broke up deadlocks");
    let log = stack.workers_log();
    for failure in ["deadlock detected", "lock timeout", "lock_not_available"] {
        assert!(!log.contains(failure), "the workers logged {failure:?}");
    }
    Ok(())
}

/// Creates a contact of the inbox, without a name, and holds its row locked
/// until the returned transaction ends, as a transaction writing to it
/// would. Storing a message that names the contact has to write the name
/// to that row, so it waits there, before any other write.
///
/// The row is locked rather than left uncommitted because an uncommitted
/// contact also holds its inbox's row, which accepting Gmail history needs.
async fn hold_contact(
    stack: &Stack,
    inbox: &Inbox,
    address: &str,
) -> Result<sqlx::Transaction<'static, sqlx::Postgres>, Report> {
    sqlx::query(
        "INSERT INTO email_contacts (id, link_id, email_address) \
         VALUES (gen_random_uuid(), $1, $2)",
    )
    .bind(inbox.link_id())
    .bind(address)
    .execute(stack.db())
    .await?;
    let mut held = stack.db().begin().await?;
    let locked = sqlx::query(
        "SELECT id FROM email_contacts WHERE link_id = $1 AND email_address = $2 FOR UPDATE",
    )
    .bind(inbox.link_id())
    .bind(address)
    .fetch_all(&mut *held)
    .await?;
    assert_eq!(locked.len(), 1, "no contact {address} to hold");
    Ok(held)
}

// -- ingest-insert-races-thread-delete --

/// A reply whose thread is deleted while the reply is being stored is
/// stored all the same, on the next delivery of its queue message. When
/// this fails the reply is dropped for good: the provider has it and Macro
/// never shows it.
///
/// The scenario holds the reply's storing still at its first write (the
/// sender's contact) by locking that contact row in a transaction of its
/// own, deletes the thread's only other message, and lets go. Takes about
/// a minute: the redelivery waits out the queue's visibility timeout.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_reply_stored_while_its_thread_is_deleted_is_not_lost() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;

    let mut first = Mail::new("Grace <grace@example.com>", "Racing thread", "First.");
    first.message_id = Some("racing-first@example.com".to_owned());
    let first = inbox.deliver(&first)?;
    let preview = inbox.wait_for_preview("inbox", "Racing thread").await?;
    let thread_id = preview["id"].as_str().unwrap_or_default().to_owned();

    let held = hold_contact(&stack, &inbox, "racer@example.com").await?;

    inbox.deliver(
        &Mail::new("Racer <racer@example.com>", "Re: Racing thread", "Second.")
            .in_reply_to("racing-first@example.com"),
    )?;
    wait_for_lock_waiters(
        &stack,
        "the reply's storing to reach its sender's contact",
        1,
    )
    .await?;

    stack.gmail().delete_message(inbox.email(), &first.id)?;
    eventually(
        "the thread to go with its only stored message",
        DEFAULT_TIMEOUT,
        async || {
            let listed = inbox.previews("inbox").await?;
            Ok((!listed
                .iter()
                .any(|preview| preview["id"] == thread_id.as_str()))
            .then_some(()))
        },
    )
    .await?;
    held.rollback().await?;

    let preview = inbox
        .wait_for_preview_where(
            "inbox",
            "the reply, stored after its thread went",
            |preview| preview["senderEmail"] == "racer@example.com",
        )
        .await?;
    let thread = inbox
        .wait_for_thread(
            preview["id"].as_str().unwrap_or_default(),
            "the reply's thread to list it",
            |thread| thread["messages"][0]["db_id"].is_string(),
        )
        .await?;
    let messages = thread["messages"].as_array().cloned().unwrap_or_default();
    assert_eq!(messages.len(), 1, "the thread holds {messages:?}");
    assert_eq!(messages[0]["from"]["email"], "racer@example.com");
    assert_eq!(stack.dead_letters("gmail-inbox-sync").await?, 0);

    stack.finish().await
}

// -- ingest-contacts-insert-deadlock --

/// How many messages arrive at once, and how many workers store them. No
/// more than the Gmail requests the service allows itself for one mailbox
/// at a time: one more and a message is put off for a minute.
const CONCURRENT_MESSAGES: usize = 5;
/// How many people every one of those messages names.
const SHARED_CONTACTS: usize = 150;

/// Messages that arrive together and name the same new people are all
/// stored, and no worker deadlocks with another over those people's
/// contact rows. When this fails the database kills one of the workers'
/// statements ("deadlock detected") and the message is late or lost.
///
/// The scenario lines the workers up twice. It holds a contact all the
/// messages name until every worker waits on it; then it lets go while it
/// is itself writing one of the new contacts, so that every worker stops
/// with part of the new contacts written and the rest still to write.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_messages_sharing_new_contacts_are_stored_without_deadlock() -> Result<(), Report> {
    let mut options = StackOptions::default();
    options.env.push((
        "INBOX_SYNC_QUEUE_WORKERS".to_owned(),
        CONCURRENT_MESSAGES.to_string(),
    ));
    let stack = Stack::start_with(options).await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;

    // Enough people that storing them takes a worker a while.
    let shared: Vec<String> = (0..SHARED_CONTACTS)
        .map(|n| format!("shared{n:03}@example.com"))
        .collect();
    let named: Vec<String> = shared
        .iter()
        .map(|address| format!("Person <{address}>"))
        .collect();
    let held = hold_contact(&stack, &inbox, &shared[0]).await?;

    for n in 0..CONCURRENT_MESSAGES {
        let mut mail = Mail::new(
            &format!("Sender {n} <sender{n}@example.com>"),
            &format!("Shared contacts {n}"),
            "Hello everyone.",
        );
        mail.to = Some(format!("{}, {}", inbox.email(), named.join(", ")));
        inbox.deliver(&mail)?;
    }
    let workers = i64::try_from(CONCURRENT_MESSAGES).unwrap_or_default();
    wait_for_lock_waiters(&stack, "every worker to wait on the known contact", workers).await?;

    // Now stop them again in the middle of the new contacts: one of those is
    // being written by someone else (here: the scenario) and not committed.
    let mut writing = stack.db().begin().await?;
    sqlx::query(
        "INSERT INTO email_contacts (id, link_id, email_address) \
         VALUES (gen_random_uuid(), $1, $2)",
    )
    .bind(inbox.link_id())
    .bind(&shared[SHARED_CONTACTS / 2])
    .execute(&mut *writing)
    .await?;
    held.rollback().await?;
    eventually(
        "every worker to wait in the middle of the new contacts",
        DEFAULT_TIMEOUT,
        async || {
            let past_the_known_contact: bool = sqlx::query_scalar(
                "SELECT name IS NOT NULL FROM email_contacts \
                 WHERE link_id = $1 AND email_address = $2",
            )
            .bind(inbox.link_id())
            .bind(&shared[0])
            .fetch_one(stack.db())
            .await?;
            let waiting = lock_waiters(&stack).await?;
            Ok((past_the_known_contact && waiting >= workers).then_some(()))
        },
    )
    .await?;
    writing.rollback().await?;

    for n in 0..CONCURRENT_MESSAGES {
        let thread =
            wait_for_thread_named(&inbox, "inbox", &format!("Shared contacts {n}")).await?;
        let mut expected = shared.clone();
        expected.push(inbox.email().to_owned());
        expected.sort();
        assert_eq!(addresses(&thread["messages"][0]["to"]), expected);
    }
    assert_no_lock_failures(&stack).await?;
    assert_eq!(stack.dead_letters("gmail-inbox-sync").await?, 0);

    stack.finish().await
}

// -- ingest-bulk-delete-lock-convoy --

/// How many messages of one sender the bulk delete removes.
const BULK_DELETED: usize = 24;

/// Deleting many messages of one sender at once goes through even while
/// one of the deletions is stuck: the others do not queue up behind it.
/// When this fails a bulk delete (emptying a newsletter's mail, a retention
/// sweep) stalls every worker behind the first deletion's lock and runs
/// into lock timeouts and redeliveries.
///
/// The scenario holds one deletion in the middle of its transaction by
/// locking its thread row, and expects every other deletion to finish
/// meanwhile.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_bulk_delete_does_not_queue_behind_one_deletion() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let subjects: Vec<String> = (0..BULK_DELETED).map(|n| format!("Issue {n:02}")).collect();
    stack.gmail().add_mailbox(&SeedMailbox {
        email: ada.email().to_owned(),
        messages: subjects
            .iter()
            .map(|subject| gmail_emulator::NewMessage {
                from: Some("Newsletter <news@example.com>".to_owned()),
                subject: Some(subject.clone()),
                text: Some("This week's news.".to_owned()),
                ..Default::default()
            })
            .collect(),
        ..Default::default()
    })?;
    let inbox = ada.link_gmail().await?;
    let listed = eventually("every issue to be listed", DEFAULT_TIMEOUT, async || {
        let listed = inbox.previews("inbox").await?;
        Ok((listed.len() == BULK_DELETED).then_some(listed))
    })
    .await?;
    let stuck_subject = subjects[0].as_str();
    let stuck_thread = listed
        .iter()
        .find(|preview| preview["name"] == stuck_subject)
        .and_then(|preview| preview["id"].as_str())
        .unwrap_or_default()
        .to_owned();
    let at_provider = inbox.provider_messages()?;
    assert_eq!(at_provider.len(), BULK_DELETED);

    let mut held = stack.db().begin().await?;
    let locked = sqlx::query("SELECT id FROM email_threads WHERE id = $1::uuid FOR UPDATE")
        .bind(&stuck_thread)
        .fetch_all(&mut *held)
        .await?;
    assert_eq!(locked.len(), 1, "no thread {stuck_thread:?} to hold");

    for message in at_provider.iter().filter(|m| m.subject == stuck_subject) {
        stack.gmail().delete_message(inbox.email(), &message.id)?;
    }
    wait_for_lock_waiters(&stack, "the first deletion to wait on its thread", 1).await?;
    for message in at_provider.iter().filter(|m| m.subject != stuck_subject) {
        stack.gmail().delete_message(inbox.email(), &message.id)?;
    }

    eventually(
        "every other deletion to finish while the first one waits",
        DEFAULT_TIMEOUT,
        async || {
            let left = inbox.previews("inbox").await?;
            Ok(left
                .iter()
                .all(|preview| preview["name"] == stuck_subject)
                .then_some(()))
        },
    )
    .await?;
    assert!(
        lock_waiters(&stack).await? >= 1,
        "the first deletion was not waiting any more"
    );
    held.rollback().await?;
    eventually("the last issue to go", DEFAULT_TIMEOUT, async || {
        Ok(inbox.previews("inbox").await?.is_empty().then_some(()))
    })
    .await?;
    assert_no_lock_failures(&stack).await?;
    assert_eq!(stack.dead_letters("gmail-inbox-sync").await?, 0);

    stack.finish().await
}

// -- message-without-sender --

/// What the search service asks the email service about its hits: the
/// history of a thread and the sender of a message.
async fn search_reads(
    inbox: &Inbox,
    user: &str,
    thread_ids: &[&str],
    message_ids: &[&str],
) -> Result<(Value, Value), Report> {
    let histories = inbox
        .post(
            "/internal/threads/histories",
            Some(&json!({ "user_id": user, "thread_ids": thread_ids })),
        )
        .await?
        .ok()?;
    let senders = inbox
        .post(
            "/internal/messages/senders",
            Some(&json!({ "user_id": user, "message_ids": message_ids })),
        )
        .await?
        .ok()?;
    Ok((
        histories["history_map"].clone(),
        senders["sender_map"].clone(),
    ))
}

/// A thread whose newest message lost its sender (the contact was removed)
/// still reads, lists, and answers the search service's lookups, next to an
/// ordinary thread. When this fails one such thread makes every search
/// that matches it answer 500.
async fn thread_without_a_sender_still_reads(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Sender will vanish",
        "Still here.",
    ))?;
    inbox.deliver(&Mail::new(
        "Alan <alan@example.com>",
        "Sender stays",
        "Here too.",
    ))?;
    let vanishing = wait_for_thread_named(&inbox, "inbox", "Sender will vanish").await?;
    let staying = wait_for_thread_named(&inbox, "inbox", "Sender stays").await?;
    let vanishing_thread = vanishing["db_id"].as_str().unwrap_or_default();
    let vanishing_message = vanishing["messages"][0]["db_id"]
        .as_str()
        .unwrap_or_default();
    let staying_thread = staying["db_id"].as_str().unwrap_or_default();
    let staying_message = staying["messages"][0]["db_id"].as_str().unwrap_or_default();

    // The sender's contact goes; the message's reference to it is set null.
    let removed = sqlx::query(
        "DELETE FROM email_contacts WHERE link_id = $1 AND email_address = 'grace@example.com'",
    )
    .bind(inbox.link_id())
    .execute(stack.db())
    .await?;
    assert_eq!(removed.rows_affected(), 1);

    let thread = inbox.thread(vanishing_thread).await?;
    assert!(
        thread["messages"][0]["from"].is_null(),
        "the message's sender is {}",
        thread["messages"][0]["from"]
    );
    assert_eq!(thread["messages"][0]["subject"], "Sender will vanish");
    let listed = inbox.previews("inbox").await?;
    assert!(
        listed
            .iter()
            .any(|preview| preview["id"] == vanishing_thread),
        "the thread without a sender is not listed: {listed:?}"
    );

    let (histories, senders) = search_reads(
        &inbox,
        ada.macro_id(),
        &[vanishing_thread, staying_thread],
        &[vanishing_message, staying_message],
    )
    .await?;
    assert_eq!(histories[vanishing_thread]["sender"], "");
    assert_eq!(histories[vanishing_thread]["subject"], "Sender will vanish");
    assert_eq!(histories[staying_thread]["sender"], "alan@example.com");
    assert_eq!(histories[staying_thread]["pretty_sender"], "Alan");
    assert!(
        senders[vanishing_message].is_null(),
        "the message without a sender has one: {senders}"
    );
    assert_eq!(senders[staying_message]["sender"], "alan@example.com");

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_thread_without_a_sender_still_reads() -> Result<(), Report> {
    thread_without_a_sender_still_reads(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_thread_without_a_sender_still_reads() -> Result<(), Report> {
    thread_without_a_sender_still_reads(Provider::Outlook).await
}

/// An Outlook draft that has no sender and carries a file is imported, its
/// file is stored as a document, and the search service's lookups answer
/// for it. When this fails the file is claimed for upload and never
/// uploaded, and the draft's import waits on it forever.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_draft_without_a_sender_gets_its_attachment_stored() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let outlook = stack.outlook();
    outlook.add_mailbox(&outlook_emulator::SeedMailbox {
        email: ada.email().to_owned(),
        ..Default::default()
    })?;
    let draft = outlook.deliver(
        ada.email(),
        &outlook_emulator::NewMessage {
            subject: Some("Unaddressed draft".to_owned()),
            text: Some("Notes to self.".to_owned()),
            folder: Some("drafts".to_owned()),
            attachments: vec![outlook_emulator::NewAttachment {
                filename: "notes.pdf".to_owned(),
                mime_type: Some("application/pdf".to_owned()),
                base64: Some("JVBERi0xLjQgbm90ZXM=".to_owned()),
                ..Default::default()
            }],
            ..Default::default()
        },
    )?;
    // Outlook keeps a draft made by some clients without a sender. The
    // emulator fills one in on delivery, so take it away as a client would.
    let cleared = reqwest::Client::new()
        .patch(format!("{}/me/messages/{}", outlook.graph_url(), draft.id))
        .bearer_auth(outlook.access_token(ada.email())?)
        .json(&json!({ "from": null }))
        .send()
        .await?;
    assert!(
        cleared.status().is_success(),
        "clearing the draft's sender answered {}",
        cleared.status()
    );

    let inbox = ada.link_outlook().await?;
    let at_provider = inbox.provider_messages()?;
    assert!(
        at_provider
            .iter()
            .any(|message| message.subject == "Unaddressed draft" && message.from.is_none()),
        "the provider's draft has a sender: {at_provider:?}"
    );

    let preview = inbox
        .wait_for_preview("drafts", "Unaddressed draft")
        .await?;
    let thread_id = preview["id"].as_str().unwrap_or_default().to_owned();
    let thread = inbox
        .wait_for_thread(&thread_id, "the draft to list its attachment", |thread| {
            thread["messages"][0]["attachments"][0]["db_id"].is_string()
        })
        .await?;
    let message = &thread["messages"][0];
    assert!(
        message["from"].is_null(),
        "the draft's sender is {}",
        message["from"]
    );
    assert_eq!(message["is_draft"], true);
    assert_eq!(attachment_names(message), ["notes.pdf"]);

    eventually(
        "the draft's attachment to be stored as a document",
        DEFAULT_TIMEOUT,
        async || {
            Ok(stack
                .stored_objects()
                .iter()
                .any(|object| object.key.starts_with("document-storage/"))
                .then_some(()))
        },
    )
    .await?;

    let message_id = message["db_id"].as_str().unwrap_or_default();
    let (histories, senders) =
        search_reads(&inbox, ada.macro_id(), &[&thread_id], &[message_id]).await?;
    assert_eq!(histories[thread_id.as_str()]["sender"], "");
    assert_eq!(histories[thread_id.as_str()]["is_draft"], true);
    assert!(
        senders[message_id].is_null(),
        "the draft has a sender: {senders}"
    );

    stack.finish().await
}
