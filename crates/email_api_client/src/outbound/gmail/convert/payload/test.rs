use base64::{Engine as _, engine::general_purpose::URL_SAFE};
use models_email::gmail::{Header, MessagePart, MessagePartBody};

use super::parse_gmail_payload;
use crate::domain::models::EmailApiError;

fn payload(mime_type: &str, data: &str) -> MessagePart {
    MessagePart {
        part_id: "part".into(),
        mime_type: mime_type.into(),
        filename: String::new(),
        headers: vec![
            Header {
                name: "From".into(),
                value: "Ada <ada@example.com>".into(),
            },
            Header {
                name: "Message-ID".into(),
                value: "global-id".into(),
            },
        ],
        body: Some(MessagePartBody {
            attachment_id: None,
            size: data.len() as i64,
            data_base64: Some(data.into()),
        }),
        parts: None,
    }
}

#[test]
fn decodes_headers_and_text_body() {
    let encoded = URL_SAFE.encode("Hello");
    let parsed = parse_gmail_payload(&payload("text/plain", &encoded), "message").unwrap();

    assert_eq!(parsed.global_id, "global-id");
    assert_eq!(parsed.from.unwrap().email, "ada@example.com");
    assert_eq!(parsed.body_text.as_deref(), Some("Hello"));
}

#[test]
fn rejects_invalid_base64_as_a_permanent_failure() {
    let result = parse_gmail_payload(&payload("text/plain", "%%%"), "message");

    assert!(matches!(result, Err(EmailApiError::Permanent { .. })));
}

#[test]
fn sanitizes_full_html_messages() {
    let encoded = URL_SAFE.encode("<html><body><p>Hello</p><script>bad()</script></body></html>");
    let parsed = parse_gmail_payload(&payload("text/html", &encoded), "message").unwrap();
    let html = parsed.body_html_sanitized.unwrap();

    assert!(html.contains("<p>Hello</p>"));
    assert!(!html.contains("script"));
}
