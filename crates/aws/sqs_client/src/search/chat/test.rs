use super::*;
use crate::{
    PrimaryId,
    search::{Operation, SearchQueueMessage},
};

#[test]
fn chat_message_with_index_override_round_trips() {
    let message = SearchQueueMessage::ChatMessage(ChatMessage {
        chat_id: "chat-1".to_string(),
        message_id: "message-1".to_string(),
        user_id: "user-1".to_string(),
        created_at: "2026-01-02T03:04:05Z".parse().unwrap(),
        updated_at: "2026-01-02T04:05:06Z".parse().unwrap(),
        index_override: Some("chats-backfill-v2".to_string()),
    });

    let serialized = serde_json::to_string(&message).unwrap();
    let deserialized: SearchQueueMessage = serde_json::from_str(&serialized).unwrap();

    assert_eq!(deserialized, message);
    assert_eq!(deserialized.id(), "message-1");
    assert!(matches!(deserialized.operation(), Operation::ExtractText));
}

#[test]
fn legacy_chat_backfill_without_index_override_deserializes() {
    let payload = r#"{
        "ChatMessage": {
            "chat_id": "chat-1",
            "message_id": "message-1",
            "user_id": "user-1",
            "created_at": "2026-01-02T03:04:05Z",
            "updated_at": "2026-01-02T04:05:06Z"
        }
    }"#;

    let message: SearchQueueMessage = serde_json::from_str(payload).unwrap();

    assert_eq!(
        message,
        SearchQueueMessage::ChatMessage(ChatMessage {
            chat_id: "chat-1".to_string(),
            message_id: "message-1".to_string(),
            user_id: "user-1".to_string(),
            created_at: "2026-01-02T03:04:05Z".parse().unwrap(),
            updated_at: "2026-01-02T04:05:06Z".parse().unwrap(),
            index_override: None,
        })
    );
}
