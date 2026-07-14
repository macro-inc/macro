use super::*;

#[test]
fn appends_to_body_after_message_when_no_quote() {
    let out = inject_signature("<body><p>Hi there</p></body>", "<p>Regards</p>");
    assert!(out.contains("macro-email-signature"), "got: {out}");
    // The signature lands after the message content.
    assert!(out.find("Hi there").unwrap() < out.find("macro-email-signature").unwrap());
}

#[test]
fn separates_signature_from_message_with_blank_line() {
    let out = inject_signature("<body><p>Hi there</p></body>", "<p>Regards</p>");
    assert!(
        out.contains(r#"<div class="macro-email-signature"><div><br></div><p>Regards</p></div>"#),
        "got: {out}"
    );
}

#[test]
fn inserts_above_quote_for_replies_and_forwards() {
    let body = r#"<body><p>My reply</p><div class="macro_quote"><p>Quoted</p></div></body>"#;
    let out = inject_signature(body, "<p>Regards</p>");
    let sig = out.find("macro-email-signature").unwrap();
    let quote = out.find("macro_quote").unwrap();
    assert!(
        sig < quote,
        "signature should sit above the quoted thread: {out}"
    );
}

#[test]
fn appends_to_bare_fragment_without_body_or_quote() {
    // No <body> element and no quote: the signature must still be added
    // (regression for the "selector didn't match" gap).
    let out = inject_signature("<p>Hello</p>", "<p>Regards</p>");
    assert!(out.contains("Hello"), "got: {out}");
    assert!(out.contains("macro-email-signature"), "got: {out}");
}

#[test]
fn is_idempotent_when_signature_already_present() {
    assert!(has_signature(
        r#"<body><div class="macro-email-signature">x</div></body>"#
    ));
    assert!(!has_signature("<body><p>no signature here</p></body>"));
}

#[test]
fn ignores_signature_inside_quoted_thread() {
    // Replying to a previously-signed message: the quote carries that message's
    // signature, which must not count as "already signed" for this reply.
    let reply = r#"<body><p>My reply</p><div class="macro_quote"><p>Old</p><div class="macro-email-signature">Ryan</div></div></body>"#;
    assert!(!has_signature(reply));
    // A signature in the reply's own content (above the quote) still counts.
    let signed = r#"<body><div class="macro-email-signature">Me</div><div class="macro_quote"><p>Old</p></div></body>"#;
    assert!(has_signature(signed));
}

#[test]
fn plain_text_joins_block_nodes_with_newlines() {
    // Block boundaries become newlines (not run together as "ThanksAlice").
    assert_eq!(
        signature_plain_text("<div>Thanks</div><div>Alice</div>"),
        "Thanks\nAlice"
    );
}

#[test]
fn plain_text_keeps_inline_markup_on_one_line() {
    // Inline tags must not introduce a line break (regression for the previous
    // text-node join that produced "Thanks\nAlice").
    assert_eq!(
        signature_plain_text("<div>Thanks <strong>Alice</strong></div>"),
        "Thanks **Alice**"
    );
}

#[test]
fn strips_server_wrapped_signature() {
    let body = inject_signature("<body><p>Hi there</p></body>", "<p>Regards</p>");
    assert!(has_signature(&body));
    let stripped = strip_signature(&body);
    assert!(
        !has_signature(&stripped),
        "signature not removed: {stripped}"
    );
    assert!(
        stripped.contains("Hi there"),
        "message body must remain: {stripped}"
    );
}
