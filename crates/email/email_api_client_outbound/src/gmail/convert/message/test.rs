use base64::{Engine as _, engine::general_purpose::URL_SAFE};
use models_email::gmail::{Header, MessagePart, MessagePartBody, MessageResource};
use uuid::Uuid;

use super::{map_message_resource_to_service, parse_address_header};

fn message() -> MessageResource {
    MessageResource {
        id: "message".into(),
        thread_id: "thread".into(),
        label_ids: vec!["UNREAD".into(), "STARRED".into()],
        snippet: "snippet".into(),
        size_estimate: 12,
        history_id: "history".into(),
        internal_date: "1700000000000".into(),
        payload: MessagePart {
            part_id: "part".into(),
            mime_type: "text/plain".into(),
            filename: String::new(),
            headers: vec![Header {
                name: "Message-ID".into(),
                value: "global".into(),
            }],
            body: Some(MessagePartBody {
                attachment_id: None,
                size: 4,
                data_base64: Some(URL_SAFE.encode("body")),
            }),
            parts: None,
        },
    }
}

#[test]
fn maps_message_flags_and_payload() {
    let mapped = map_message_resource_to_service(message(), Uuid::now_v7()).unwrap();

    assert!(!mapped.is_read);
    assert!(mapped.is_starred);
    assert!(!mapped.is_sent);
    assert_eq!(mapped.body_text.as_deref(), Some("body"));
    assert_eq!(mapped.global_id.as_deref(), Some("global"));
}

#[test]
fn parses_groups_and_salvages_truncated_address_lists() {
    assert_eq!(
        parse_address_header("Group: Ada <ada@example.com>, Bob <bob@example.com>;"),
        vec![
            (Some("Ada".into()), "ada@example.com".into()),
            (Some("Bob".into()), "bob@example.com".into()),
        ]
    );
    assert_eq!(
        parse_address_header("Ada <ada@example.com>, Broken <broken@example"),
        vec![(Some("Ada".into()), "ada@example.com".into())]
    );
    // Missing '>' at the end.
    assert_eq!(
        parse_address_header("John <john@example.com>, Partial <email@domain"),
        vec![(Some("John".into()), "john@example.com".into())]
    );
}

#[test]
fn parses_quoted_display_names_containing_commas() {
    assert_eq!(
        parse_address_header(r#""Asdf, Fdsa" <asdf.fdsa@ff.com>, "aaa, ddd" <aaa.ddd@ff"#),
        vec![(Some("Asdf, Fdsa".into()), "asdf.fdsa@ff.com".into())]
    );
    assert_eq!(
        parse_address_header(
            r#""First, Last" <first.last@example.com>, "Second, Name" <second@example.com>, "Third, Complex, Name" <third@incomplete"#
        ),
        vec![
            (Some("First, Last".into()), "first.last@example.com".into()),
            (Some("Second, Name".into()), "second@example.com".into()),
        ]
    );
    assert_eq!(
        parse_address_header(r#""Initial, With, Commas" <initial@example.com>"#),
        vec![(
            Some("Initial, With, Commas".into()),
            "initial@example.com".into()
        )]
    );
}

#[test]
fn unparseable_headers_yield_no_addresses() {
    // Providers substitute this placeholder when recipients are hidden.
    assert!(parse_address_header("(withheld recipients)").is_empty());
    assert!(parse_address_header("This is not an email address").is_empty());
    assert!(parse_address_header("").is_empty());
    // Still invalid even after the truncation salvage.
    assert!(parse_address_header("Invalid <not-an-email@, Another <not-an-email@").is_empty());
}

#[test]
fn parses_the_real_world_truncated_recipient_header() {
    let header = "Evan Macrotest <evanmacrotest@outlook.com>, evanmacrotest <evanmacrotest@gmail.com>, Recipient Name <evan.hutnik@gm";

    assert_eq!(
        parse_address_header(header),
        vec![
            (
                Some("Evan Macrotest".into()),
                "evanmacrotest@outlook.com".into()
            ),
            (
                Some("evanmacrotest".into()),
                "evanmacrotest@gmail.com".into()
            ),
        ]
    );
}
