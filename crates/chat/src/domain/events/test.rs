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

#[test]
fn created_round_trips_all_owner_kinds_with_the_v1_string_wire_format() {
    for principal in [
        "macro|owner@acme.com",
        "bot|00000000-0000-0000-0000-000000000001",
        "01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f",
    ] {
        let payload = json!({
            "event_id": EVENT_ID,
            "schema_version": 1,
            "event_type": "chat.created",
            "metadata": {
                "chat_id": CHAT_ID,
                "owner": principal,
                "name": "New Chat",
                "project_id": null,
            },
        });
        let decoded = ChatMacroEvent::decode(CHAT_ID, &serde_json::to_vec(&payload).unwrap())
            .expect("v1 owner strings decode through the broker");
        assert_eq!(decoded.event().schema_version, 1);
        assert_eq!(<ChatTopicEvent as TopicEvent>::SCHEMA_VERSION, 1);
        let ChatTopicEvent::Created(metadata) = &decoded.event().event else {
            panic!("expected a created event");
        };
        assert_eq!(
            metadata.owner,
            Owner::from_principal_str(principal).unwrap()
        );
        assert_eq!(serde_json::to_value(decoded.event()).unwrap(), payload);
    }
}

fn topic_events() -> Vec<(ChatTopicEvent, Value)> {
    vec![
        (
            ChatTopicEvent::Created(ChatCreatedMetadata {
                chat_id: CHAT_ID.to_string(),
                owner: Owner::User(user_id("macro|owner@acme.com")),
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
        (
            ChatTopicEvent::MessageDeleted(ChatMessageDeletedMetadata {
                chat_id: CHAT_ID.to_string(),
                message_id: MESSAGE_ID.to_string(),
            }),
            json!({
                "event_type": "chat.message_deleted",
                "metadata": {
                    "chat_id": CHAT_ID,
                    "message_id": MESSAGE_ID
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
            ChatTopicEvent::MessageDeleted(metadata) => ChatMacroEvent::message_deleted(metadata),
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

mod exposure {
    use super::*;
    use macro_event_broker::exposure::{Audience, EntityType, Exposure, PublicEvent, Stage};

    fn actor() -> MacroUserIdStr<'static> {
        MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap()
    }

    fn public(event: &ChatTopicEvent) -> PublicEvent<'_, ChatPublicEvent> {
        match event.exposure().unwrap() {
            Exposure::Public(public) => public,
            Exposure::Internal(reason) => panic!("expected public, got {reason}"),
        }
    }

    fn message_sent() -> ChatTopicEvent {
        ChatTopicEvent::MessageSent(ChatMessageSentMetadata {
            chat_id: CHAT_ID.to_owned(),
            message_id: MESSAGE_ID.to_owned(),
            role: ChatMessageRole::User,
            model: "some-model".to_owned(),
            actor_user_id: Some(actor()),
            attachment_count: 2,
        })
    }

    #[test]
    fn chat_events_reach_the_chat_audience_in_preview() {
        let events = [
            ChatTopicEvent::Created(ChatCreatedMetadata {
                chat_id: CHAT_ID.to_owned(),
                owner: Owner::User(actor()),
                name: "Plans".to_owned(),
                project_id: Some(PROJECT_ID.to_owned()),
            }),
            ChatTopicEvent::Updated(ChatUpdatedMetadata {
                chat_id: CHAT_ID.to_owned(),
                actor_user_id: actor(),
                name: None,
                previous_project_id: None,
                project_id: None,
                share_permission_updated: true,
            }),
            ChatTopicEvent::Deleted(ChatDeletedMetadata {
                chat_id: CHAT_ID.to_owned(),
                actor_user_id: None,
                project_id: None,
            }),
            ChatTopicEvent::Restored(ChatRestoredMetadata {
                chat_id: CHAT_ID.to_owned(),
                actor_user_id: None,
                project_id: None,
            }),
            ChatTopicEvent::Copied(ChatCopiedMetadata {
                chat_id: CHAT_ID.to_owned(),
                source_chat_id: SOURCE_CHAT_ID.to_owned(),
                owner: actor(),
                name: "Copy".to_owned(),
            }),
            message_sent(),
            ChatTopicEvent::MessageDeleted(ChatMessageDeletedMetadata {
                chat_id: CHAT_ID.to_owned(),
                message_id: MESSAGE_ID.to_owned(),
            }),
        ];
        for event in &events {
            let public = public(event);
            assert_eq!(
                public.audience,
                Audience::Entity {
                    entity_type: EntityType::Chat,
                    entity_id: CHAT_ID.to_owned(),
                },
                "{}",
                public.name
            );
            assert_eq!(public.entity.entity_id, CHAT_ID);
            assert_eq!(public.stage, Stage::Preview);
            assert_eq!(
                serde_json::to_value(public.payload.as_ref()).unwrap()["event_type"],
                public.name
            );
        }
    }

    #[test]
    fn message_sent_payload_omits_model_and_attachments() {
        let event = message_sent();
        assert_eq!(
            serde_json::to_value(public(&event).payload.as_ref()).unwrap(),
            json!({
                "event_type": "chat.message_sent",
                "metadata": {
                    "chat_id": CHAT_ID,
                    "message_id": MESSAGE_ID,
                    "role": "user",
                    "actor_user_id": "macro|owner@example.com",
                },
            })
        );
    }

    #[test]
    fn updated_payload_names_what_changed_without_values() {
        let event = ChatTopicEvent::Updated(ChatUpdatedMetadata {
            chat_id: CHAT_ID.to_owned(),
            actor_user_id: actor(),
            name: Some("Renamed".to_owned()),
            previous_project_id: Some(PROJECT_ID.to_owned()),
            project_id: Some(String::new()),
            share_permission_updated: false,
        });
        assert_eq!(
            serde_json::to_value(public(&event).payload.as_ref()).unwrap(),
            json!({
                "event_type": "chat.updated",
                "metadata": {
                    "chat_id": CHAT_ID,
                    "actor_user_id": "macro|owner@example.com",
                    "changes": ["name", "project"],
                },
            })
        );
    }

    #[test]
    fn permanent_delete_stays_internal() {
        let event = ChatTopicEvent::PermanentlyDeleted(ChatPermanentlyDeletedMetadata {
            chat_id: CHAT_ID.to_owned(),
            actor_user_id: None,
            project_id: None,
        });
        assert!(matches!(event.exposure().unwrap(), Exposure::Internal(_)));
    }

    #[test]
    fn public_payload_has_a_schema() {
        use utoipa::ToSchema as _;
        assert_eq!(ChatPublicEvent::name(), "ChatPublicEvent");
    }
}
