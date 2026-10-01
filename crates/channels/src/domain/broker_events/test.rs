use macro_event_broker::Event;
use serde_json::json;

use super::*;

fn user(id: &str) -> ChannelSender<'static> {
    ChannelSender::try_from(id.to_string()).expect("valid user principal")
}

fn user_id(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
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
