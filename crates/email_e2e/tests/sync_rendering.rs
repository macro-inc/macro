//! The body the API serves for a received message: the sanitized HTML, the
//! text, the reply without its quoted thread, and what its images need.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use email_e2e::{Inbox, Mail, Provider, Report, Stack};
use rootcause::prelude::*;
use serde_json::Value;

/// Who the test mail is from.
const GRACE: &str = "Grace <grace@example.com>";
/// The attribution line a mail client puts above the thread it quotes.
const ATTRIBUTION: &str = "On Mon, Oct 26, 2026 at 10:15 AM Grace &lt;grace@example.com&gt; wrote:";
/// A one-pixel PNG.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
];
/// The `Content-ID` of the inline image, without angle brackets.
const CONTENT_ID: &str = "logo123@example.com";

/// A linked inbox of one provider.
async fn linked_inbox(provider: Provider) -> Result<(Stack, Inbox), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    Ok((stack, inbox))
}

/// An HTML message with this subject.
fn html_mail(subject: &str, html: &str) -> Mail {
    let mut mail = Mail::new(GRACE, subject, "The text part.");
    mail.html = Some(html.to_owned());
    mail
}

/// Waits for the message with this subject and returns it as the thread
/// endpoint serves it.
async fn served(inbox: &Inbox, subject: &str) -> Result<Value, Report> {
    let preview = inbox.wait_for_preview("inbox", subject).await?;
    let thread = inbox
        .thread(preview["id"].as_str().unwrap_or_default())
        .await?;
    Ok(thread["messages"][0].clone())
}

/// Delivers a message and returns it as the thread endpoint serves it.
async fn received(inbox: &Inbox, mail: &Mail) -> Result<Value, Report> {
    inbox.deliver(mail)?;
    served(inbox, &mail.subject).await
}

fn text<'a>(message: &'a Value, field: &str) -> &'a str {
    message[field].as_str().unwrap_or_default()
}

/// The text with Unix line ends: Gmail serves a text part as it was sent,
/// with CRLF.
fn unix_lines(text: &str) -> String {
    text.replace("\r\n", "\n")
}

/// A reply whose text shares an element with the "On … wrote:" line keeps
/// its text when the quoted thread is cut off, whether the quote follows
/// inside that element or after it. When this fails, the reply-less body is
/// the whole quoted thread, or the reply with the attribution still on it.
async fn reply_sharing_an_element_with_its_attribution_is_kept(
    provider: Provider,
) -> Result<(), Report> {
    let (stack, inbox) = linked_inbox(provider).await?;

    let shapes = [
        (
            "Quote inside the element",
            format!("<div>My answer<br>{ATTRIBUTION}<blockquote>Older words</blockquote></div>"),
        ),
        (
            "Quote after the element",
            format!("<div>My answer<br>{ATTRIBUTION}</div><blockquote>Older words</blockquote>"),
        ),
    ];
    for (subject, html) in &shapes {
        inbox.deliver(&html_mail(subject, html))?;
    }
    for (subject, _) in &shapes {
        let message = served(&inbox, subject).await?;
        let reply = text(&message, "body_replyless");
        assert!(
            reply.contains("My answer"),
            "{subject}: the reply lost its text: {reply:?}"
        );
        assert!(
            !reply.contains("Older words"),
            "{subject}: the quoted thread is still in the reply: {reply:?}"
        );
        assert!(
            !reply.contains("wrote:"),
            "{subject}: the attribution is still in the reply: {reply:?}"
        );
        // The whole message is still there for "show quoted text".
        assert!(text(&message, "body_html_sanitized").contains("Older words"));
    }

    stack.finish().await
}

/// A reply written in Outlook mobile is cut at the horizontal rule above its
/// `divRplyFwdMsg` header, in HTML and in plain text. When this fails, the
/// first quoted message stays in the reply, down to a "From:" header nested
/// further below.
async fn reply_from_outlook_mobile_is_cut_at_its_rule(provider: Provider) -> Result<(), Report> {
    let (stack, inbox) = linked_inbox(provider).await?;

    let html = "<div>New text from my phone</div><div>Sent from Outlook for iOS</div>\
        <div style=\"text-align:center\"><hr></div>\
        <div id=\"divRplyFwdMsg\" dir=\"ltr\"><b>From:</b> Grace &lt;grace@example.com&gt;<br>\
        <b>Sent:</b> Monday, October 26, 2026 10:15 AM<br><b>To:</b> Ada &lt;ada@example.com&gt;<br>\
        <b>Subject:</b> Re: Roadmap</div>\
        <div>First quoted message\
        <div style=\"border-top:solid #E1E1E1 1.0pt; padding:3.0pt 0 0 0\"><b>From:</b> Ada &lt;ada@example.com&gt;<br>\
        <b>Sent:</b> Sunday, October 25, 2026 9:00 AM<br><b>To:</b> Grace &lt;grace@example.com&gt;<br>\
        <b>Subject:</b> Roadmap</div><div>Oldest words</div></div>";
    let message = received(&inbox, &html_mail("Roadmap from a phone", html)).await?;
    let reply = text(&message, "body_replyless");
    assert!(reply.contains("New text from my phone"), "{reply:?}");
    assert!(reply.contains("Sent from Outlook for iOS"), "{reply:?}");
    assert!(
        !reply.contains("First quoted message"),
        "the first quoted message is still in the reply: {reply:?}"
    );
    assert!(
        !reply.contains("<hr"),
        "the rule goes with the quote: {reply:?}"
    );
    assert!(!reply.contains("divRplyFwdMsg"), "{reply:?}");
    assert!(text(&message, "body_html_sanitized").contains("Oldest words"));

    let plain = "New text from my phone\n\n________________________________\n\
        From: Grace <grace@example.com>\nSent: Monday, October 26, 2026 10:15 AM\n\
        To: Ada <ada@example.com>\nSubject: Re: Roadmap\n\nFirst quoted message\n";
    let message = received(&inbox, &Mail::new(GRACE, "Roadmap as text", plain)).await?;
    assert_eq!(message["body_html_sanitized"], Value::Null);
    assert_eq!(
        text(&message, "body_replyless"),
        "New text from my phone",
        "the plain-text reply ends before the rule"
    );

    stack.finish().await
}

/// A message's bodies are the same text on every read, attributes in the
/// order the mail wrote them. When this fails, the app sees a "changed" body
/// on each refetch and re-renders the thread, which makes it jump while a
/// draft saves.
async fn bodies_are_the_same_on_every_read(provider: Provider) -> Result<(), Report> {
    let (stack, inbox) = linked_inbox(provider).await?;

    let reply = "<div dir=\"ltr\" class=\"reply\" style=\"color:blue\" id=\"a1\" title=\"t\" lang=\"en\">\
        <a href=\"https://example.com/a\" title=\"A &amp; B\" target=\"_blank\" name=\"n\" rel=\"noopener noreferrer\">Reply</a>\
        <table width=\"100\" border=\"0\" cellpadding=\"2\" cellspacing=\"1\" bgcolor=\"#ffffff\" align=\"center\"><tbody><tr>\
        <td width=\"50\" height=\"10\" align=\"left\" valign=\"top\" bgcolor=\"#eeeeee\" colspan=\"2\">cell</td>\
        </tr></tbody></table></div>";
    let html = format!("{reply}<blockquote>Older message</blockquote>");
    inbox.deliver(&html_mail("Many attributes", &html))?;
    let preview = inbox.wait_for_preview("inbox", "Many attributes").await?;
    let thread_id = preview["id"].as_str().unwrap_or_default();

    for read in 0..8 {
        let thread = inbox.thread(thread_id).await?;
        let message = &thread["messages"][0];
        assert_eq!(
            text(message, "body_replyless"),
            reply,
            "read {read}: the reply-less body is not the reply as it was written"
        );
        assert_eq!(text(message, "body_html_sanitized"), html, "read {read}");
    }

    stack.finish().await
}

/// The quoted thread is cut from a Gmail reply (`div.gmail_quote`) and from a
/// plain-text reply (`>` lines under an attribution); a message that quotes
/// nothing is served whole. When this fails, every reply in a thread repeats
/// the conversation above it, or a plain message loses text.
async fn quoted_thread_is_cut_from_the_reply(provider: Provider) -> Result<(), Report> {
    let (stack, inbox) = linked_inbox(provider).await?;

    let gmail = format!(
        "<div dir=\"ltr\">Sounds good.</div><br><div class=\"gmail_quote\">\
         <div dir=\"ltr\" class=\"gmail_attr\">{ATTRIBUTION}<br></div>\
         <blockquote class=\"gmail_quote\" style=\"margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex\">Older words</blockquote></div>"
    );
    let message = received(&inbox, &html_mail("Re: From Gmail", &gmail)).await?;
    assert_eq!(
        text(&message, "body_replyless"),
        "<div dir=\"ltr\">Sounds good.</div><br>"
    );
    assert!(text(&message, "body_html_sanitized").contains("Older words"));

    let plain = "Agreed.\n\nOn Mon, Oct 26, 2026 at 10:15 AM Grace <grace@example.com> wrote:\n\
                 > Older words\n> and more\n";
    let message = received(&inbox, &Mail::new(GRACE, "Re: In plain text", plain)).await?;
    assert_eq!(text(&message, "body_replyless"), "Agreed.");
    assert!(text(&message, "body_text").contains("> Older words"));

    let whole = "<p>Just a <b>note</b>, nothing quoted.</p>";
    let message = received(&inbox, &html_mail("A note", whole)).await?;
    assert_eq!(text(&message, "body_html_sanitized"), whole);
    assert_eq!(text(&message, "body_replyless"), whole);

    stack.finish().await
}

/// A message with only a text part is served with that text and no HTML.
/// When this fails, plain mail opens empty.
async fn plain_text_mail_is_served_as_text(provider: Provider) -> Result<(), Report> {
    let (stack, inbox) = linked_inbox(provider).await?;

    let body = "Just text.\nSecond line.\n\n  Indented <not a tag> & more.";
    let message = received(&inbox, &Mail::new(GRACE, "Plain", body)).await?;
    assert_eq!(message["body_html_sanitized"], Value::Null);
    assert_eq!(unix_lines(text(&message, "body_text")).trim_end(), body);
    assert_eq!(unix_lines(text(&message, "body_replyless")), body);
    assert!(text(&message, "snippet").starts_with("Just text. Second line."));

    stack.finish().await
}

/// The sanitized HTML keeps what a mail needs to look right (links, tables,
/// inline styles, a style sheet's harmless rules, remote images) and drops
/// what could run or reach out (scripts, event handlers, `javascript:` links,
/// frames, forms, positioning, `url()` in CSS). When this fails, either mail
/// renders broken or a sender can run code in the reader's app.
async fn sanitized_html_keeps_layout_and_drops_scripts(provider: Provider) -> Result<(), Report> {
    let (stack, inbox) = linked_inbox(provider).await?;

    let html = "<html><head>\
        <style>.x{color:red;position:fixed;background:url(https://evil.example/x.png)}</style>\
        <script>alert(1)</script></head><body>\
        <p style=\"color:#333;font-size:14px;position:fixed\" onclick=\"steal()\">Hello</p>\
        <a href=\"https://example.com/offer?a=1&amp;b=2\" target=\"_blank\" onmouseover=\"x()\">Offer</a>\
        <a href=\"javascript:alert(1)\">bad</a>\
        <table style=\"border-collapse:collapse\" width=\"600\" cellpadding=\"4\"><tr>\
        <td style=\"padding:8px;background-color:#eee\" colspan=\"2\">Cell</td></tr></table>\
        <script>alert(2)</script><iframe src=\"https://evil.example\"></iframe>\
        <form action=\"https://evil.example\"><input name=\"p\"></form>\
        <img src=\"https://images.example/logo.png\" onerror=\"x()\" alt=\"logo\">\
        </body></html>";
    let message = received(&inbox, &html_mail("Newsletter", html)).await?;
    assert_eq!(
        text(&message, "body_html_sanitized"),
        "<style>.x{color:red;}</style>\
         <p style=\"color:#333;font-size:14px\">Hello</p>\
         <a href=\"https://example.com/offer?a=1&amp;b=2\" target=\"_blank\" rel=\"noopener noreferrer\">Offer</a>\
         <a rel=\"noopener noreferrer\">bad</a>\
         <table style=\"border-collapse:collapse\" width=\"600\" cellpadding=\"4\"><tbody><tr>\
         <td style=\"padding:8px;background-color:#eee\" colspan=\"2\">Cell</td></tr></tbody></table>\
         <img src=\"https://images.example/logo.png\" alt=\"logo\">"
    );
    assert_eq!(message["body_replyless"], message["body_html_sanitized"]);

    stack.finish().await
}

/// Delivers a message whose HTML shows an attached image through `cid:`.
fn deliver_inline_image(stack: &Stack, inbox: &Inbox, subject: &str) -> Result<String, Report> {
    let html = format!("<p>Inline</p><img src=\"cid:{CONTENT_ID}\" alt=\"inline\">");
    let image = STANDARD.encode(PNG);
    match inbox.provider() {
        Provider::Gmail => {
            let raw = format!(
                "From: {GRACE}\r\nTo: {to}\r\nSubject: {subject}\r\n\
                 Message-ID: <inline-1@example.com>\r\nMIME-Version: 1.0\r\n\
                 Content-Type: multipart/related; boundary=\"rel\"\r\n\r\n\
                 --rel\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{html}\r\n\
                 --rel\r\nContent-Type: image/png; name=\"logo.png\"\r\n\
                 Content-Transfer-Encoding: base64\r\nContent-ID: <{CONTENT_ID}>\r\n\
                 Content-Disposition: inline; filename=\"logo.png\"\r\n\r\n{image}\r\n--rel--\r\n",
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
                    from: Some(GRACE.to_owned()),
                    subject: Some(subject.to_owned()),
                    html: Some(html.clone()),
                    attachments: vec![outlook_emulator::NewAttachment {
                        filename: "logo.png".to_owned(),
                        mime_type: Some("image/png".to_owned()),
                        base64: Some(image),
                        content_id: Some(CONTENT_ID.to_owned()),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            )?;
        }
    }
    Ok(html)
}

/// What the app needs to show a message's images is in the API's answer: a
/// remote image keeps its address, and an inline (`cid:`) image keeps its
/// reference next to an attachment with that `Content-ID` whose bytes are
/// stored for the app and download intact. When this fails, the message
/// shows broken images.
async fn remote_and_inline_images_can_load(provider: Provider) -> Result<(), Report> {
    let (stack, inbox) = linked_inbox(provider).await?;

    let remote =
        "<p>Remote</p><img src=\"https://images.example/remote.png\" alt=\"remote\" width=\"10\">";
    let message = received(&inbox, &html_mail("Remote image", remote)).await?;
    assert_eq!(text(&message, "body_html_sanitized"), remote);
    assert_eq!(message["attachments"], Value::Array(Vec::new()));

    let inline = deliver_inline_image(&stack, &inbox, "Inline image")?;
    let preview = inbox.wait_for_preview("inbox", "Inline image").await?;
    let thread = inbox
        .wait_for_thread(
            preview["id"].as_str().unwrap_or_default(),
            "the inline image to be stored for the app",
            |thread| thread["messages"][0]["attachments"][0]["sfs_id"].is_string(),
        )
        .await?;
    let message = &thread["messages"][0];
    assert_eq!(text(message, "body_html_sanitized"), inline);
    let attachments = message["attachments"].as_array().map_or(0, Vec::len);
    assert_eq!(attachments, 1);
    let attachment = &message["attachments"][0];
    assert_eq!(
        text(attachment, "content_id").trim_matches(['<', '>']),
        CONTENT_ID,
        "the attachment answers the body's cid: reference"
    );
    assert_eq!(attachment["mime_type"], "image/png");

    // The copy the app's <img> points at, by the attachment's static file id.
    let stored_as = format!("static-files/{}", text(attachment, "sfs_id"));
    let stored = stack
        .stored_objects()
        .into_iter()
        .find(|object| object.key == stored_as)
        .ok_or_else(|| report!("no static file was stored as {stored_as}"))?;
    assert_eq!(stored.bytes.as_ref(), PNG);
    assert_eq!(stored.content_type, "image/png");

    // And the attachment itself downloads.
    let downloaded = inbox.download_attachment(text(attachment, "db_id")).await?;
    assert_eq!(downloaded.as_ref(), PNG);

    stack.finish().await
}

/// An image embedded in the HTML as a `data:` address is still an image in
/// the sanitized HTML. When this fails, the image is served without a source
/// and shows broken, with nothing the app could load instead.
async fn embedded_data_image_keeps_its_source(provider: Provider) -> Result<(), Report> {
    let (stack, inbox) = linked_inbox(provider).await?;

    let source = format!("data:image/png;base64,{}", STANDARD.encode(PNG));
    let html = format!("<p>Embedded</p><img src=\"{source}\" alt=\"embedded\">");
    let message = received(&inbox, &html_mail("Embedded image", &html)).await?;
    assert_eq!(text(&message, "body_html_sanitized"), html);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_reply_sharing_an_element_with_its_attribution_is_kept() -> Result<(), Report> {
    reply_sharing_an_element_with_its_attribution_is_kept(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_reply_sharing_an_element_with_its_attribution_is_kept() -> Result<(), Report> {
    reply_sharing_an_element_with_its_attribution_is_kept(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_reply_from_outlook_mobile_is_cut_at_its_rule() -> Result<(), Report> {
    reply_from_outlook_mobile_is_cut_at_its_rule(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_reply_from_outlook_mobile_is_cut_at_its_rule() -> Result<(), Report> {
    reply_from_outlook_mobile_is_cut_at_its_rule(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_bodies_are_the_same_on_every_read() -> Result<(), Report> {
    bodies_are_the_same_on_every_read(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_bodies_are_the_same_on_every_read() -> Result<(), Report> {
    bodies_are_the_same_on_every_read(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_quoted_thread_is_cut_from_the_reply() -> Result<(), Report> {
    quoted_thread_is_cut_from_the_reply(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_quoted_thread_is_cut_from_the_reply() -> Result<(), Report> {
    quoted_thread_is_cut_from_the_reply(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_plain_text_mail_is_served_as_text() -> Result<(), Report> {
    plain_text_mail_is_served_as_text(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_plain_text_mail_is_served_as_text() -> Result<(), Report> {
    plain_text_mail_is_served_as_text(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_sanitized_html_keeps_layout_and_drops_scripts() -> Result<(), Report> {
    sanitized_html_keeps_layout_and_drops_scripts(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_sanitized_html_keeps_layout_and_drops_scripts() -> Result<(), Report> {
    sanitized_html_keeps_layout_and_drops_scripts(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_remote_and_inline_images_can_load() -> Result<(), Report> {
    remote_and_inline_images_can_load(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_remote_and_inline_images_can_load() -> Result<(), Report> {
    remote_and_inline_images_can_load(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: render-remote-images-not-loading"]
async fn gmail_embedded_data_image_keeps_its_source() -> Result<(), Report> {
    embedded_data_image_keeps_its_source(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: render-remote-images-not-loading"]
async fn outlook_embedded_data_image_keeps_its_source() -> Result<(), Report> {
    embedded_data_image_keeps_its_source(Provider::Outlook).await
}
