use chrono::{DateTime, Utc};
use macro_event_broker::Event;
use serde_json::json;

use super::*;

fn user(id: &str) -> ChannelSender<'static> {
    ChannelSender::try_from(id.to_string()).expect("valid user principal")
}

fn user_id(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn timestamp() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
        .expect("valid timestamp")
        .with_timezone(&Utc)
}

#[test]
fn created_event_wire_shape() {
    let channel_id = Uuid::nil();
    let event_id = Uuid::nil();
    let event = Event::with_event_id(
        event_id,
        ChannelTopicEvent::Created(ChannelCreatedMetadata {
            channel_id,
            actor: user("macro|owner@example.com"),
            on_behalf_of: None,
            channel_type: ChannelType::Private,
            channel_name: Some("general".to_string()),
            participant_user_ids: vec![
                user_id("macro|owner@example.com"),
                user_id("macro|member@example.com"),
            ],
        }),
    );

    let value = serde_json::to_value(&event).expect("serializable");
    assert_eq!(
        value,
        json!({
            "event_id": "00000000-0000-0000-0000-000000000000",
            "schema_version": 1,
            "event_type": "channel.created",
            "metadata": {
                "channel_id": "00000000-0000-0000-0000-000000000000",
                "actor": "macro|owner@example.com",
                "channel_type": "private",
                "channel_name": "general",
                "participant_user_ids": [
                    "macro|owner@example.com",
                    "macro|member@example.com",
                ],
            },
        })
    );
}

#[test]
fn created_event_wire_shape_includes_on_behalf_of() {
    let channel_id = Uuid::nil();
    let actor = ChannelSender::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID);
    let event = Event::with_event_id(
        Uuid::nil(),
        ChannelTopicEvent::Created(ChannelCreatedMetadata {
            channel_id,
            actor: actor.clone(),
            on_behalf_of: Some(user_id("macro|owner@example.com")),
            channel_type: ChannelType::Private,
            channel_name: Some("Macro Support x owner".to_string()),
            participant_user_ids: vec![user_id("macro|owner@example.com")],
        }),
    );

    let value = serde_json::to_value(&event).expect("serializable");
    assert_eq!(
        value,
        json!({
            "event_id": "00000000-0000-0000-0000-000000000000",
            "schema_version": 1,
            "event_type": "channel.created",
            "metadata": {
                "channel_id": "00000000-0000-0000-0000-000000000000",
                "actor": actor.as_ref(),
                "on_behalf_of": "macro|owner@example.com",
                "channel_type": "private",
                "channel_name": "Macro Support x owner",
                "participant_user_ids": [
                    "macro|owner@example.com",
                ],
            },
        })
    );
}

#[test]
fn message_posted_wire_shape_with_bot_sender() {
    let channel_id = Uuid::nil();
    let message_id = Uuid::nil();
    let bot_uuid = Uuid::nil();
    let event = Event::with_event_id(
        Uuid::nil(),
        ChannelTopicEvent::MessagePosted(ChannelMessagePostedMetadata {
            channel_id,
            message_id,
            thread_id: None,
            sender: user(&format!("bot|{bot_uuid}")),
            triggered_by: Some("macro|human@example.com".to_string()),
            channel_type: ChannelType::Team,
            content: "hello world".to_string(),
            mentions: vec![SimpleMention {
                entity_type: "user".to_string(),
                entity_id: "macro|member@example.com".to_string(),
            }],
            attachments: vec![ChannelEventAttachment {
                attachment_id: Uuid::nil(),
                entity_type: "document".to_string(),
                entity_id: "doc-1".to_string(),
                created_at: timestamp(),
            }],
            created_at: timestamp(),
        }),
    );

    let value = serde_json::to_value(&event).expect("serializable");
    assert_eq!(
        value,
        json!({
            "event_id": "00000000-0000-0000-0000-000000000000",
            "schema_version": 1,
            "event_type": "channel.message_posted",
            "metadata": {
                "channel_id": "00000000-0000-0000-0000-000000000000",
                "message_id": "00000000-0000-0000-0000-000000000000",
                "thread_id": null,
                "sender": "bot|00000000-0000-0000-0000-000000000000",
                "triggered_by": "macro|human@example.com",
                "channel_type": "team",
                "content": "hello world",
                "mentions": [
                    { "entity_type": "user", "entity_id": "macro|member@example.com" },
                ],
                "attachments": [
                    {
                        "attachment_id": "00000000-0000-0000-0000-000000000000",
                        "entity_type": "document",
                        "entity_id": "doc-1",
                        "created_at": "2026-01-02T03:04:05Z",
                    },
                ],
                "created_at": "2026-01-02T03:04:05Z",
            },
        })
    );
}

#[test]
fn mentioned_wire_shape() {
    let bot_principal = "bot|00000000-0000-0000-0000-00000000a1a1";
    let event = Event::with_event_id(
        Uuid::nil(),
        ChannelTopicEvent::Mentioned(ChannelMentionedMetadata {
            channel_id: Uuid::nil(),
            message_id: Uuid::nil(),
            thread_id: None,
            sender: user("macro|human@example.com"),
            channel_type: ChannelType::Team,
            content: "hello bot".to_string(),
            mentioned: SimpleMention {
                entity_type: "bot".to_string(),
                entity_id: bot_principal.to_string(),
            },
            created_at: timestamp(),
        }),
    );

    let value = serde_json::to_value(&event).expect("serializable");
    assert_eq!(
        value,
        json!({
            "event_id": "00000000-0000-0000-0000-000000000000",
            "schema_version": 1,
            "event_type": "channel.mentioned",
            "metadata": {
                "channel_id": "00000000-0000-0000-0000-000000000000",
                "message_id": "00000000-0000-0000-0000-000000000000",
                "thread_id": null,
                "sender": "macro|human@example.com",
                "channel_type": "team",
                "content": "hello bot",
                "mentioned": { "entity_type": "bot", "entity_id": bot_principal },
                "created_at": "2026-01-02T03:04:05Z",
            },
        })
    );

    let decoded: Event<ChannelTopicEvent> =
        serde_json::from_value(value).expect("decodable payload");
    assert_eq!(&decoded, &event);
}

#[test]
fn decode_round_trips() {
    let channel_id = Uuid::new_v4();
    let original = ChannelMacroEvent::participant_removed(ChannelParticipantRemovedMetadata {
        channel_id,
        channel_type: ChannelType::Private,
        removed_by: user_id("macro|admin@example.com"),
        removed_user_ids: vec![user_id("macro|member@example.com")],
    });

    let payload = serde_json::to_vec(original.event()).expect("serializable");
    let decoded = ChannelMacroEvent::decode(original.key(), &payload).expect("decodable payload");

    assert_eq!(decoded.key(), channel_id.to_string());
    assert_eq!(decoded.event(), original.event());
}

#[test]
fn events_are_keyed_by_channel_id() {
    let channel_id = Uuid::new_v4();
    let event = ChannelMacroEvent::deleted(ChannelDeletedMetadata {
        channel_id,
        actor: user("macro|owner@example.com"),
    });
    assert_eq!(event.key(), channel_id.to_string());
}

#[test]
fn event_type_strings_follow_dot_convention() {
    let channel_id = Uuid::nil();
    let actor = user("macro|owner@example.com");
    let attachment_metadata = ChannelMessageAttachmentCreatedMetadata {
        channel_id,
        message_id: Uuid::nil(),
        actor: actor.clone(),
        attachments: vec![],
    };

    let cases = vec![
        (
            ChannelMacroEvent::updated(ChannelUpdatedMetadata {
                channel_id,
                actor: user_id("macro|owner@example.com"),
                previous_name: None,
                channel_name: Some("renamed".to_string()),
            }),
            "channel.updated",
        ),
        (
            ChannelMacroEvent::message_patched(ChannelMessagePatchedMetadata {
                channel_id,
                message_id: Uuid::nil(),
                thread_id: None,
                actor: actor.clone(),
                content: "edited".to_string(),
                edited_at: Some(timestamp()),
                updated_at: timestamp(),
            }),
            "channel.message_patched",
        ),
        (
            ChannelMacroEvent::message_deleted(ChannelMessageDeletedMetadata {
                channel_id,
                message_id: Uuid::nil(),
                thread_id: None,
                actor: actor.clone(),
                deleted_at: Some(timestamp()),
            }),
            "channel.message_deleted",
        ),
        (
            ChannelMacroEvent::message_attachment_created(attachment_metadata.clone()),
            "channel.message_attachment_created",
        ),
        (
            ChannelMacroEvent::message_attachment_removed(
                ChannelMessageAttachmentRemovedMetadata {
                    channel_id,
                    message_id: Uuid::nil(),
                    actor,
                    attachments: attachment_metadata.attachments,
                },
            ),
            "channel.message_attachment_removed",
        ),
        (
            ChannelMacroEvent::participant_added(ChannelParticipantAddedMetadata {
                channel_id,
                channel_type: ChannelType::Team,
                added_by: user("macro|owner@example.com"),
                added_user_ids: vec![user_id("macro|member@example.com")],
            }),
            "channel.participant_added",
        ),
    ];

    for (event, expected_type) in cases {
        let value = serde_json::to_value(event.event()).expect("serializable");
        assert_eq!(value["event_type"], *expected_type);
    }
}
