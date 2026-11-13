use messages::domain::models::Message;
use messages::domain::ports::MessageError;
use serde_json::json;
use uuid::Uuid;

use super::located;
use crate::ping::LocatedMessage;

const CHANNEL: Uuid = Uuid::from_u128(0xC0);
const MESSAGE: Uuid = Uuid::from_u128(0x101);
const ROOT: Uuid = Uuid::from_u128(0x7A);

fn message(thread_id: Option<Uuid>, deleted_at: Option<&str>) -> Message {
    serde_json::from_value(json!({
        "id": MESSAGE,
        "parent": { "type": "channel", "id": CHANNEL },
        "thread_id": thread_id,
        "sender_id": "macro|author@macro.com",
        "imported_author": null,
        "bot_profile": null,
        "mentions": [],
        "triggered_by": null,
        "content": "hello",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
        "edited_at": null,
        "deleted_at": deleted_at,
        "attachments": [],
        "reactions": [],
    }))
    .unwrap()
}

#[test]
fn a_reply_is_located_in_its_thread_and_a_top_level_message_in_none() {
    assert_eq!(
        located(CHANNEL, Ok(message(Some(ROOT), None))).unwrap(),
        Some(LocatedMessage {
            channel_id: CHANNEL,
            message_id: MESSAGE,
            thread_id: Some(ROOT),
        })
    );
    assert_eq!(
        located(CHANNEL, Ok(message(None, None))).unwrap(),
        Some(LocatedMessage {
            channel_id: CHANNEL,
            message_id: MESSAGE,
            thread_id: None,
        })
    );
}

#[test]
fn a_deleted_missing_or_forbidden_message_is_not_there() {
    assert_eq!(
        located(CHANNEL, Ok(message(None, Some("2026-01-02T00:00:00Z")))).unwrap(),
        None
    );
    assert_eq!(located(CHANNEL, Err(MessageError::NotFound)).unwrap(), None);
    assert_eq!(
        located(CHANNEL, Err(MessageError::Forbidden)).unwrap(),
        None
    );
}

#[test]
fn a_failed_read_is_an_error() {
    assert!(located(CHANNEL, Err(MessageError::Invalid("broken"))).is_err());
}
