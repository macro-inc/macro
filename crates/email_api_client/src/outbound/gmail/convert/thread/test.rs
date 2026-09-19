use base64::{Engine as _, engine::general_purpose::URL_SAFE};
use models_email::gmail::{Header, MessagePart, MessagePartBody, MessageResource, ThreadResource};
use uuid::Uuid;

use super::map_thread_resource_to_service;

fn message(id: &str, timestamp: i64, labels: Vec<String>) -> MessageResource {
    MessageResource {
        id: id.into(),
        thread_id: "thread".into(),
        label_ids: labels,
        snippet: String::new(),
        size_estimate: 1,
        history_id: "history".into(),
        internal_date: timestamp.to_string(),
        payload: MessagePart {
            part_id: String::new(),
            mime_type: "text/plain".into(),
            filename: String::new(),
            headers: vec![
                Header {
                    name: "Message-ID".into(),
                    value: id.into(),
                },
                Header {
                    name: "From".into(),
                    value: "sender@example.com".into(),
                },
            ],
            body: Some(MessagePartBody {
                attachment_id: None,
                size: 0,
                data_base64: Some(URL_SAFE.encode("")),
            }),
            parts: None,
        },
    }
}

#[test]
fn thread_with_an_undecodable_message_body_still_converts() {
    let mut broken = message("broken", 1_000, vec!["INBOX".into()]);
    broken.payload.body = Some(MessagePartBody {
        attachment_id: None,
        size: 3,
        data_base64: Some("%%%".into()),
    });
    let resource = ThreadResource {
        id: "thread".into(),
        messages: vec![broken, message("fine", 2_000, vec![])],
    };

    let thread = map_thread_resource_to_service(resource, Uuid::now_v7()).unwrap();

    assert_eq!(thread.messages.len(), 2);
    assert_eq!(thread.messages[0].provider_id.as_deref(), Some("broken"));
    assert_eq!(thread.messages[0].body_text, None);
}

#[test]
fn sorts_messages_and_derives_thread_state() {
    let resource = ThreadResource {
        id: "thread".into(),
        messages: vec![
            message("later", 2_000, vec!["INBOX".into()]),
            message("earlier", 1_000, vec!["UNREAD".into()]),
        ],
    };

    let thread = map_thread_resource_to_service(resource, Uuid::now_v7()).unwrap();

    assert_eq!(thread.messages[0].provider_id.as_deref(), Some("earlier"));
    assert!(thread.inbox_visible);
    assert!(!thread.is_read);
    assert!(
        thread
            .messages
            .iter()
            .all(|message| message.thread_db_id == thread.db_id)
    );
}
