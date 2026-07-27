use macro_event_broker::{Event, MacroEvent};
use macro_event_topics::{MacroChatsTopic, Topic};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Value, json};
use uuid::Uuid;

use super::*;

const CHAT_ID: &str = "3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90";
const SOURCE_CHAT_ID: &str = "0197f776-6e7b-7c69-a251-780ae754d3e4";
const MESSAGE_ID: &str = "7d2c1e5a-4b3f-4c6d-8e9f-0a1b2c3d4e5f";
const PROJECT_ID: &str = "c1a2b3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const EVENT_ID: &str = "01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f";

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid user id")
}

fn topic_events() -> Vec<(ChatTopicEvent, Value)> {
    vec![
        (
            ChatTopicEvent::Created(ChatCreatedMetadata {
                chat_id: CHAT_ID.to_string(),
                owner: user_id("macro|owner@acme.com"),
                name: "New Chat".to_string(),
                project_id: Some(PROJECT_ID.to_string()),
            }),
            json!({
                "event_type": "chat.created",
                "metadata": {
                    "chat_id": CHAT_ID,
                    "owner": "macro|owner@acme.com",
                    "name": "New Chat",
                    "project_id": PROJECT_ID
                }
            }),
        ),
        (
            ChatTopicEvent::Updated(ChatUpdatedMetadata {
                chat_id: CHAT_ID.to_string(),
                actor_user_id: user_id("macro|editor@acme.com"),
                name: Some("Renamed Chat".to_string()),
                previous_project_id: Some(PROJECT_ID.to_string()),
                project_id: Some(String::new()),
                share_permission_updated: true,
            }),
            json!({
                "event_type": "chat.updated",
                "metadata": {
                    "chat_id": CHAT_ID,
                    "actor_user_id": "macro|editor@acme.com",
                    "name": "Renamed Chat",
                    "previous_project_id": PROJECT_ID,
                    "project_id": "",
                    "share_permission_updated": true
                }
            }),
        ),
        (
            ChatTopicEvent::Deleted(ChatDeletedMetadata {
                chat_id: CHAT_ID.to_string(),
                actor_user_id: Some(user_id("macro|owner@acme.com")),
                project_id: Some(PROJECT_ID.to_string()),
            }),
            json!({
                "event_type": "chat.deleted",
                "metadata": {
                    "chat_id": CHAT_ID,
                    "actor_user_id": "macro|owner@acme.com",
                    "project_id": PROJECT_ID
                }
            }),
        ),
        (
            ChatTopicEvent::PermanentlyDeleted(ChatPermanentlyDeletedMetadata {
                chat_id: CHAT_ID.to_string(),
                actor_user_id: None,
                project_id: None,
            }),
            json!({
                "event_type": "chat.permanently_deleted",
                "metadata": {
                    "chat_id": CHAT_ID,
                    "actor_user_id": null,
                    "project_id": null
                }
            }),
        ),
        (
            ChatTopicEvent::Restored(ChatRestoredMetadata {
                chat_id: CHAT_ID.to_string(),
                actor_user_id: Some(user_id("macro|owner@acme.com")),
                project_id: None,
            }),
            json!({
                "event_type": "chat.restored",
                "metadata": {
                    "chat_id": CHAT_ID,
                    "actor_user_id": "macro|owner@acme.com",
                    "project_id": null
                }
            }),
        ),
        (
            ChatTopicEvent::Copied(ChatCopiedMetadata {
                chat_id: CHAT_ID.to_string(),
                source_chat_id: SOURCE_CHAT_ID.to_string(),
                owner: user_id("macro|copier@acme.com"),
                name: "New Chat Copy".to_string(),
            }),
            json!({
                "event_type": "chat.copied",
                "metadata": {
                    "chat_id": CHAT_ID,
                    "source_chat_id": SOURCE_CHAT_ID,
                    "owner": "macro|copier@acme.com",
                    "name": "New Chat Copy"
                }
            }),
        ),
        (
            ChatTopicEvent::MessageSent(ChatMessageSentMetadata {
                chat_id: CHAT_ID.to_string(),
                message_id: MESSAGE_ID.to_string(),
                role: ChatMessageRole::User,
                model: "gpt-test".to_string(),
                actor_user_id: Some(user_id("macro|sender@acme.com")),
                attachment_count: 2,
            }),
            json!({
                "event_type": "chat.message_sent",
                "metadata": {
                    "chat_id": CHAT_ID,
                    "message_id": MESSAGE_ID,
                    "role": "user",
                    "model": "gpt-test",
                    "actor_user_id": "macro|sender@acme.com",
                    "attachment_count": 2
                }
            }),
        ),
        (
            ChatTopicEvent::MessageSent(ChatMessageSentMetadata {
                chat_id: CHAT_ID.to_string(),
                message_id: MESSAGE_ID.to_string(),
                role: ChatMessageRole::Assistant,
                model: "gpt-test".to_string(),
                actor_user_id: None,
                attachment_count: 0,
            }),
            json!({
                "event_type": "chat.message_sent",
                "metadata": {
                    "chat_id": CHAT_ID,
                    "message_id": MESSAGE_ID,
                    "role": "assistant",
                    "model": "gpt-test",
                    "actor_user_id": null,
                    "attachment_count": 0
                }
            }),
        ),
    ]
}

fn macro_events() -> Vec<ChatMacroEvent> {
    topic_events()
        .into_iter()
        .map(|(event, _)| match event {
            ChatTopicEvent::Created(metadata) => ChatMacroEvent::created(metadata),
            ChatTopicEvent::Updated(metadata) => ChatMacroEvent::updated(metadata),
            ChatTopicEvent::Deleted(metadata) => ChatMacroEvent::deleted(metadata),
            ChatTopicEvent::PermanentlyDeleted(metadata) => {
                ChatMacroEvent::permanently_deleted(metadata)
            }
            ChatTopicEvent::Restored(metadata) => ChatMacroEvent::restored(metadata),
            ChatTopicEvent::Copied(metadata) => ChatMacroEvent::copied(metadata),
            ChatTopicEvent::MessageSent(metadata) => ChatMacroEvent::message_sent(metadata),
        })
        .collect()
}

#[test]
fn every_variant_has_exact_json_envelope() {
    let event_id = Uuid::parse_str(EVENT_ID).expect("valid event id");

    for (event, expected_payload) in topic_events() {
        let mut expected = expected_payload;
        let object = expected.as_object_mut().expect("expected object");
        object.insert("event_id".to_string(), json!(EVENT_ID));
        object.insert("schema_version".to_string(), json!(1));

        assert_eq!(
            serde_json::to_value(Event::with_event_id(event_id, event))
                .expect("serializable event"),
            expected
        );
    }
}

#[test]
fn every_variant_round_trips() {
    for original in macro_events() {
        let payload = serde_json::to_vec(original.event()).expect("serializable event");
        let decoded = ChatMacroEvent::decode(original.key(), &payload).expect("decodable event");

        assert_eq!(decoded.key(), CHAT_ID);
        assert_eq!(decoded.event(), original.event());
        assert_eq!(decoded.topic(), MacroChatsTopic::TOPIC_STR);
        assert_eq!(decoded.topic(), "macro.chats");
    }
}

#[test]
fn constructors_use_chats_topic_bare_chat_id_key_and_schema_version_one() {
    for event in macro_events() {
        assert_eq!(event.key(), CHAT_ID);
        assert_eq!(event.topic(), "macro.chats");
        assert_eq!(event.event().schema_version, 1);
    }
}

#[test]
fn message_roles_serialize_lowercase() {
    assert_eq!(serde_json::to_value(ChatMessageRole::User).unwrap(), "user");
    assert_eq!(
        serde_json::to_value(ChatMessageRole::Assistant).unwrap(),
        "assistant"
    );
    assert_eq!(
        serde_json::to_value(ChatMessageRole::System).unwrap(),
        "system"
    );
}

#[test]
fn message_roles_convert_from_agent_roles() {
    assert_eq!(
        ChatMessageRole::from(agent::types::Role::User),
        ChatMessageRole::User
    );
    assert_eq!(
        ChatMessageRole::from(agent::types::Role::Assistant),
        ChatMessageRole::Assistant
    );
    assert_eq!(
        ChatMessageRole::from(agent::types::Role::System),
        ChatMessageRole::System
    );
}
