use super::*;
use models_email::gmail::MessagePartBody;

#[test]
fn discovers_inline_and_attachment_calendar_parts() {
    let root = MessagePart {
        part_id: String::new(),
        mime_type: "multipart/mixed".to_string(),
        filename: String::new(),
        headers: Vec::new(),
        body: None,
        parts: Some(vec![
            MessagePart {
                part_id: "inline".to_string(),
                mime_type: "text/calendar; method=REQUEST".to_string(),
                filename: String::new(),
                headers: Vec::new(),
                body: Some(MessagePartBody {
                    attachment_id: None,
                    size: 10,
                    data_base64: Some("aGVsbG8".to_string()),
                }),
                parts: None,
            },
            MessagePart {
                part_id: "attachment".to_string(),
                mime_type: "application/octet-stream".to_string(),
                filename: "invite.ICS".to_string(),
                headers: Vec::new(),
                body: Some(MessagePartBody {
                    attachment_id: Some("gmail-id".to_string()),
                    size: 10,
                    data_base64: None,
                }),
                parts: None,
            },
        ]),
    };

    let parts = calendar_parts(&root);
    assert_eq!(parts.len(), 2);
    assert!(
        parts
            .iter()
            .any(|part| part.attachment_id == Some("gmail-id"))
    );
}

#[test]
fn accepts_padded_and_unpadded_base64url() {
    assert_eq!(decode_base64url("aGVsbG8").unwrap(), b"hello");
    assert_eq!(decode_base64url("aGVsbG8=").unwrap(), b"hello");
}
