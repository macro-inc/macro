//! The inbox's signature on mail sent from Macro, as recipients receive it.

#[path = "send_support/support.rs"]
mod support;

use email_e2e::{Mail, Provider, Report, Stack};
use serde_json::json;
use support::{first_message, html, set_signature, wait_for_wire};

/// The class the server wraps an injected signature in.
const SIGNATURE_MARKER: &str = "macro-email-signature";
/// The class of the quoted thread under a reply.
const QUOTE_MARKER: &str = "macro_quote";
/// The blank line the server puts between the message and the signature.
const SPACER: &str = "<div><br></div>";
/// A three-line signature as the signature editor saves it: every paragraph
/// carries its own zero margin, because a sent email has no stylesheet.
const SIGNATURE: &str = concat!(
    r#"<p style="margin:0">Ada Example</p>"#,
    r#"<p style="margin:0">Analytical Engines Ltd</p>"#,
    r#"<p style="margin:0">+44 20 7946 0000</p>"#,
);

/// A new message goes out with the signature under the text, separated from
/// it by one blank line, and with the paragraph margins the editor saved.
/// Without the blank line the signature is glued to the last line; without
/// the inline margins its lines drift apart in the recipient's client.
async fn new_message_carries_the_signature(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;
    set_signature(&from, SIGNATURE, true).await?;

    from.send(&json!({
        "subject": "Signed hello",
        "to": [{ "email": grace.email() }],
        "body_text": "The engine is ready.",
        "body_html": html("<html><body><div>The engine is ready.</div></body></html>"),
    }))
    .await?;

    let (_, received) = wait_for_wire(&stack, &to, "Signed hello").await?;
    let body = received.html.find("The engine is ready.");
    let signature = received.html.find(SIGNATURE_MARKER);
    assert!(
        body.is_some() && signature.is_some() && body < signature,
        "the signature is missing or above the text: {}",
        received.html
    );
    assert_eq!(
        received.html_count(SIGNATURE_MARKER),
        1,
        "the signature is there more than once: {}",
        received.html
    );
    let spacer = received.html.find(SPACER);
    let name = received.html.find("Ada Example");
    assert!(
        spacer.is_some() && signature < spacer && spacer < name,
        "no blank line between the text and the signature: {}",
        received.html
    );
    assert_eq!(
        received.html_count(r#"<p style="margin:0">"#),
        3,
        "the signature's paragraphs lost their inline margins: {}",
        received.html
    );
    if provider == Provider::Gmail {
        assert!(
            received
                .text
                .replace("\r\n", "\n")
                .contains("The engine is ready.\n\nAda Example"),
            "the plain-text part has no signature after a blank line: {:?}",
            received.text
        );
    }

    stack.finish().await
}

/// A reply to a message that itself carries a Macro signature still gets
/// the sender's signature, once, above the quoted thread. The signature in
/// the quote is the other person's: taking it for the sender's own leaves
/// the reply unsigned.
async fn reply_to_a_signed_message_is_signed(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;
    set_signature(&from, SIGNATURE, true).await?;

    let quoted_signature =
        format!(r#"<div class="{SIGNATURE_MARKER}"><p>Grace Example, Director</p></div>"#);
    from.deliver(&Mail {
        html: Some(format!("<div>Is it ready?</div>{quoted_signature}")),
        ..Mail::new(
            &format!("Grace <{}>", grace.email()),
            "Status",
            "Is it ready?",
        )
    })?;
    let preview = from.wait_for_preview("inbox", "Status").await?;
    let original = first_message(&from, &preview).await?;

    let reply = format!(
        "<html><body><div>It is.</div>\
         <div class=\"{QUOTE_MARKER}\"><blockquote><div>Is it ready?</div>{quoted_signature}</blockquote></div>\
         </body></html>"
    );
    from.send(&json!({
        "subject": "Re: Status",
        "to": [{ "email": grace.email() }],
        "replying_to_id": original["db_id"],
        "body_text": "It is.",
        "body_html": html(&reply),
    }))
    .await?;

    let (_, received) = wait_for_wire(&stack, &to, "Re: Status").await?;
    let own = received.html.find("Ada Example");
    let quote = received.html.find(QUOTE_MARKER);
    assert!(
        own.is_some(),
        "the reply went out without the sender's signature: {}",
        received.html
    );
    assert!(
        quote.is_some() && own < quote,
        "the signature is not above the quoted thread: {}",
        received.html
    );
    assert_eq!(
        received.html_count("Ada Example"),
        1,
        "the sender's signature is there more than once: {}",
        received.html
    );
    assert_eq!(
        received.html_count("Grace Example, Director"),
        1,
        "the quoted signature was lost or repeated: {}",
        received.html
    );

    stack.finish().await
}

/// The inbox's reply setting and the composer's per-message switch decide
/// whether a signature goes out: off for replies when the inbox says so,
/// and off for any message the sender removed it from. If this fails, mail
/// goes out signed against the sender's choice, or unsigned when it was on.
async fn signature_follows_the_settings(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let grace = stack.user("grace").await?;
    let from = ada.link(provider, ada.email()).await?;
    let to = grace.link(provider, grace.email()).await?;
    set_signature(&from, SIGNATURE, false).await?;

    from.deliver(&Mail::new(
        &format!("Grace <{}>", grace.email()),
        "Lunch",
        "Noon?",
    ))?;
    let preview = from.wait_for_preview("inbox", "Lunch").await?;
    let original = first_message(&from, &preview).await?;

    from.send(&json!({
        "subject": "Re: Lunch",
        "to": [{ "email": grace.email() }],
        "replying_to_id": original["db_id"],
        "body_text": "Noon works.",
        "body_html": html("<html><body><div>Noon works.</div></body></html>"),
    }))
    .await?;
    from.send(&json!({
        "subject": "Unsigned on purpose",
        "to": [{ "email": grace.email() }],
        "body_text": "No signature here.",
        "body_html": html("<html><body><div>No signature here.</div></body></html>"),
        "include_signature": false,
    }))
    .await?;
    from.send(&json!({
        "subject": "Signed by default",
        "to": [{ "email": grace.email() }],
        "body_text": "Signature here.",
        "body_html": html("<html><body><div>Signature here.</div></body></html>"),
    }))
    .await?;

    let (_, reply) = wait_for_wire(&stack, &to, "Re: Lunch").await?;
    assert!(
        !reply.html.contains("Ada Example"),
        "a reply was signed although the inbox signs new mail only: {}",
        reply.html
    );
    let (_, unsigned) = wait_for_wire(&stack, &to, "Unsigned on purpose").await?;
    assert!(
        !unsigned.html.contains("Ada Example"),
        "a message was signed although its sender removed the signature: {}",
        unsigned.html
    );
    let (_, signed) = wait_for_wire(&stack, &to, "Signed by default").await?;
    assert_eq!(signed.html_count("Ada Example"), 1, "{}", signed.html);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_new_message_carries_the_signature() -> Result<(), Report> {
    new_message_carries_the_signature(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_new_message_carries_the_signature() -> Result<(), Report> {
    new_message_carries_the_signature(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_reply_to_a_signed_message_is_signed() -> Result<(), Report> {
    reply_to_a_signed_message_is_signed(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_reply_to_a_signed_message_is_signed() -> Result<(), Report> {
    reply_to_a_signed_message_is_signed(Provider::Outlook).await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_signature_follows_the_settings() -> Result<(), Report> {
    signature_follows_the_settings(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_signature_follows_the_settings() -> Result<(), Report> {
    signature_follows_the_settings(Provider::Outlook).await
}
