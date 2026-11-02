use base64::{
    Engine as _,
    engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD},
};
use models_email::gmail::{Header, MessagePart, MessagePartBody};

use super::parse_gmail_payload;

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
fn skips_undecodable_body_data_but_keeps_the_message() {
    let parsed = parse_gmail_payload(&payload("text/plain", "%%%"), "message").unwrap();

    assert_eq!(parsed.body_text, None);
    assert_eq!(parsed.global_id, "global-id");
    assert_eq!(parsed.from.unwrap().email, "ada@example.com");
}

#[test]
fn accepts_unpadded_base64url_bodies() {
    let encoded = URL_SAFE_NO_PAD.encode("Hello");
    assert!(
        encoded.len() % 4 != 0,
        "fixture must exercise unpadded input"
    );

    let parsed = parse_gmail_payload(&payload("text/plain", &encoded), "message").unwrap();

    assert_eq!(parsed.body_text.as_deref(), Some("Hello"));
}

#[test]
fn honors_declared_non_utf8_charsets() {
    // "café" in ISO-8859-1: the 0xE9 byte is invalid UTF-8 and would become
    // U+FFFD under a blind lossy conversion.
    let encoded = URL_SAFE.encode([b'c', b'a', b'f', 0xE9]);
    let mut part = payload("text/plain", &encoded);
    part.headers.push(Header {
        name: "Content-Type".into(),
        value: "text/plain; charset=\"ISO-8859-1\"".into(),
    });

    let parsed = parse_gmail_payload(&part, "message").unwrap();

    assert_eq!(parsed.body_text.as_deref(), Some("café"));
}

#[test]
fn prefers_valid_utf8_over_a_misdeclared_single_byte_charset() {
    let body = "<p>• A dedicated Macro product walkthrough</p>";
    let encoded = URL_SAFE.encode(body);
    let mut part = payload("text/html", &encoded);
    part.headers.push(Header {
        name: "Content-Type".into(),
        value: "text/html; charset=Windows-1252".into(),
    });

    let parsed = parse_gmail_payload(&part, "message").unwrap();
    let html = parsed.body_html_sanitized.unwrap();

    assert!(html.contains("• A dedicated Macro product walkthrough"));
    assert!(!html.contains("â€¢"));
}

#[test]
fn unknown_charsets_fall_back_to_lossy_utf8() {
    let encoded = URL_SAFE.encode("Hello");
    let mut part = payload("text/plain", &encoded);
    part.headers.push(Header {
        name: "Content-Type".into(),
        value: "text/plain; charset=not-a-real-charset".into(),
    });

    let parsed = parse_gmail_payload(&part, "message").unwrap();

    assert_eq!(parsed.body_text.as_deref(), Some("Hello"));
}

#[test]
fn one_bad_part_does_not_sink_sibling_parts() {
    let mut root = payload("multipart/alternative", "");
    root.body = None;

    let mut bad = payload("text/plain", "%%%");
    bad.headers.clear();
    bad.part_id = "bad-part".into();

    let mut good = payload("text/html", &URL_SAFE.encode("<p>Hello</p>"));
    good.headers.clear();
    good.part_id = "good-part".into();

    root.parts = Some(vec![bad, good]);

    let parsed = parse_gmail_payload(&root, "message").unwrap();

    assert_eq!(parsed.body_text, None);
    assert!(
        parsed
            .body_html_sanitized
            .as_deref()
            .unwrap()
            .contains("<p>Hello</p>")
    );
}

#[test]
fn a_bounce_reads_as_its_report_not_the_returned_original() {
    let report = MessagePart {
        part_id: "0".into(),
        mime_type: "text/plain".into(),
        filename: String::new(),
        headers: Vec::new(),
        body: Some(MessagePartBody {
            attachment_id: None,
            size: 36,
            data_base64: Some(URL_SAFE.encode("Your message could not be delivered.")),
        }),
        parts: None,
    };
    let status = MessagePart {
        part_id: "1".into(),
        mime_type: "message/delivery-status".into(),
        filename: String::new(),
        headers: Vec::new(),
        body: Some(MessagePartBody {
            attachment_id: Some("status-id".into()),
            size: 300,
            data_base64: None,
        }),
        parts: None,
    };
    let original_html = MessagePart {
        part_id: "2.0.0".into(),
        mime_type: "text/html".into(),
        filename: String::new(),
        headers: Vec::new(),
        body: Some(MessagePartBody {
            attachment_id: None,
            size: 23,
            data_base64: Some(URL_SAFE.encode("<p>Original message</p>")),
        }),
        parts: None,
    };
    let original_file = MessagePart {
        part_id: "2.0.1".into(),
        mime_type: "application/pdf".into(),
        filename: "contract.pdf".into(),
        headers: vec![Header {
            name: "Content-Disposition".into(),
            value: "attachment; filename=\"contract.pdf\"".into(),
        }],
        body: Some(MessagePartBody {
            attachment_id: Some("contract-id".into()),
            size: 2048,
            data_base64: None,
        }),
        parts: None,
    };
    let original = MessagePart {
        part_id: "2".into(),
        mime_type: "message/rfc822".into(),
        filename: String::new(),
        headers: Vec::new(),
        body: Some(MessagePartBody {
            attachment_id: None,
            size: 0,
            data_base64: None,
        }),
        parts: Some(vec![MessagePart {
            part_id: "2.0".into(),
            mime_type: "multipart/mixed".into(),
            filename: String::new(),
            headers: Vec::new(),
            body: None,
            parts: Some(vec![original_html, original_file]),
        }]),
    };
    let mut root = payload("multipart/report", "");
    root.body = None;
    root.parts = Some(vec![report, status, original]);

    let parsed = parse_gmail_payload(&root, "message").unwrap();

    assert_eq!(
        parsed.body_text.as_deref(),
        Some("Your message could not be delivered.")
    );
    assert_eq!(parsed.body_html_sanitized, None);
    assert_eq!(
        parsed
            .attachments_metadata
            .iter()
            .map(|attachment| attachment.filename.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("contract.pdf")]
    );
}

#[test]
fn sanitizes_full_html_messages() {
    let encoded = URL_SAFE.encode("<html><body><p>Hello</p><script>bad()</script></body></html>");
    let parsed = parse_gmail_payload(&payload("text/html", &encoded), "message").unwrap();
    let html = parsed.body_html_sanitized.unwrap();

    assert!(html.contains("<p>Hello</p>"));
    assert!(!html.contains("script"));
}
