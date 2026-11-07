use models_email::email::service::address::ContactInfo;
use models_email::email::service::attachment::AttachmentToSend;
use models_email::email::service::message::MessageToSend;
use uuid::Uuid;

use super::SendRequest;

fn contact(email: &str, name: &str) -> ContactInfo {
    ContactInfo {
        email: email.to_string(),
        name: Some(name.to_string()),
        photo_url: None,
    }
}

#[test]
fn mime_contains_recipients_threading_bodies_and_attachments() {
    let request = SendRequest {
        message_id: Some("stable-send@example.com".to_string()),
        message: MessageToSend {
            db_id: None,
            provider_id: None,
            replying_to_id: None,
            provider_thread_id: Some("provider-thread".to_string()),
            thread_db_id: None,
            link_id: Uuid::nil(),
            subject: "Provider-neutral send".to_string(),
            to: Some(vec![contact("to@example.com", "To Recipient")]),
            cc: Some(vec![contact("cc@example.com", "Cc Recipient")]),
            bcc: Some(vec![contact("bcc@example.com", "Bcc Recipient")]),
            body_text: Some("Plain body".to_string()),
            body_html: Some("<strong>HTML body</strong>".to_string()),
            body_macro: None,
            attachments: Some(vec![AttachmentToSend {
                content_id: None,
                is_inline: false,
                file_name: "notes.txt".to_string(),
                content_type: "text/plain".to_string(),
                data: b"attachment contents".to_vec(),
            }]),
            headers_json: None,
            send_time: None,
        },
        from: contact("sender@example.com", "Sender"),
        parent_message_id: Some("parent@example.com".to_string()),
        references: Some(vec![
            "root@example.com".to_string(),
            "parent@example.com".to_string(),
        ]),
    };

    let mime = String::from_utf8(request.build_mime().expect("MIME should build"))
        .expect("generated MIME should be UTF-8 for this fixture");

    assert!(mime.contains("From:"));
    assert!(mime.contains("Message-ID: <stable-send@example.com>\r\n"));
    assert_eq!(mime.matches("Message-ID:").count(), 1);
    assert!(mime.contains("sender@example.com"));
    assert!(mime.contains("To:"));
    assert!(mime.contains("to@example.com"));
    assert!(mime.contains("Cc:"));
    assert!(mime.contains("cc@example.com"));
    assert!(mime.contains("Bcc:"));
    assert!(mime.contains("bcc@example.com"));
    assert!(mime.contains("In-Reply-To: <parent@example.com>"));
    assert!(mime.contains("References: <root@example.com> <parent@example.com>"));
    assert!(mime.contains("Plain body"));
    assert!(mime.contains("<strong>HTML body</strong>"));
    assert!(mime.contains("filename=\"notes.txt\""));
    assert!(mime.contains("attachment contents") || mime.contains("YXR0YWNobWVudCBjb250ZW50cw=="));
}

#[test]
fn stable_message_id_rejects_header_or_query_injection() {
    for id in [
        "",
        "<already-bracketed@example.com>",
        "bad\r\nBcc: other@example.com",
        "id@example.com OR in:sent",
        "id@@example.com",
    ] {
        assert!(super::validate_message_id(id).is_err());
    }
    assert!(super::validate_message_id("email-send-123+attempt@macro.com").is_ok());
}

fn message(attachments: Vec<AttachmentToSend>) -> SendRequest {
    SendRequest {
        message_id: Some("stable-send@example.com".to_string()),
        message: MessageToSend {
            db_id: None,
            provider_id: None,
            replying_to_id: None,
            provider_thread_id: None,
            thread_db_id: None,
            link_id: Uuid::nil(),
            subject: "Office tour".to_string(),
            to: Some(vec![contact("to@example.com", "To Recipient")]),
            cc: None,
            bcc: None,
            body_text: Some("Plain body".to_string()),
            body_html: Some("<div>HTML body</div>".to_string()),
            body_macro: None,
            attachments: Some(attachments),
            headers_json: None,
            send_time: None,
        },
        from: contact("sender@example.com", "Sender"),
        parent_message_id: None,
        references: None,
    }
}

const INVITATION: &str = "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:meeting@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

fn calendar_body() -> AttachmentToSend {
    AttachmentToSend {
        content_id: None,
        is_inline: true,
        file_name: "invite.ics".to_string(),
        content_type: "text/calendar; method=REQUEST".to_string(),
        data: INVITATION.as_bytes().to_vec(),
    }
}

/// The parts of `mime` in order, as their Content-Type lines.
fn content_types(mime: &str) -> Vec<String> {
    mime.split("\r\n")
        .filter(|line| line.to_ascii_lowercase().starts_with("content-type:"))
        .map(|line| line["content-type:".len()..].trim().to_string())
        .collect()
}

#[test]
fn an_inline_calendar_part_is_the_last_alternative_and_the_file_follows() {
    let request = message(vec![
        calendar_body(),
        AttachmentToSend {
            content_id: None,
            is_inline: false,
            file_name: "invite.ics".to_string(),
            content_type: "application/ics".to_string(),
            data: INVITATION.as_bytes().to_vec(),
        },
    ]);

    let mime = String::from_utf8(request.build_mime().unwrap()).unwrap();
    let types = content_types(&mime);

    assert!(types[0].starts_with("multipart/mixed"), "{types:?}");
    assert!(types[1].starts_with("multipart/alternative"), "{types:?}");
    assert!(types[2].starts_with("text/plain"), "{types:?}");
    assert!(types[3].starts_with("text/html"), "{types:?}");
    assert!(
        types[4].starts_with("text/calendar; method=REQUEST"),
        "{types:?}"
    );
    assert!(types[5].starts_with("application/ics"), "{types:?}");
    assert_eq!(types.len(), 6, "{types:?}");
    assert_eq!(mime.matches("filename=\"invite.ics\"").count(), 1, "{mime}");
    assert!(mime.contains("UID:meeting@example.com"), "{mime}");
}

#[test]
fn a_calendar_body_without_files_is_the_whole_message() {
    let mime = String::from_utf8(message(vec![calendar_body()]).build_mime().unwrap()).unwrap();
    let types = content_types(&mime);

    assert!(types[0].starts_with("multipart/alternative"), "{types:?}");
    assert_eq!(types.len(), 4, "{types:?}");
}

#[test]
fn a_calendar_file_or_an_inline_image_stays_an_attachment() {
    let mime = String::from_utf8(
        message(vec![
            AttachmentToSend {
                content_id: None,
                is_inline: false,
                file_name: "Office tour.ics".to_string(),
                content_type: "text/calendar".to_string(),
                data: INVITATION.as_bytes().to_vec(),
            },
            AttachmentToSend {
                content_id: Some("logo@example.com".to_string()),
                is_inline: true,
                file_name: "logo.png".to_string(),
                content_type: "image/png".to_string(),
                data: vec![0x89, 0x50, 0x4e, 0x47],
            },
        ])
        .build_mime()
        .unwrap(),
    )
    .unwrap();
    let types = content_types(&mime);

    assert!(types[0].starts_with("multipart/mixed"), "{types:?}");
    assert!(types[1].starts_with("multipart/alternative"), "{types:?}");
    assert!(mime.contains("filename=\"Office tour.ics\""), "{mime}");
    assert!(mime.contains("Content-ID: <logo@example.com>"), "{mime}");
}
