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
