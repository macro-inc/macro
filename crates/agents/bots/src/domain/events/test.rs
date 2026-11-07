use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Value, json};
use uuid::Uuid;

use super::*;

const BOT_ID: &str = "0197f776-6e7b-7c69-a251-780ae754d3e4";
const TEAM_ID: &str = "3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90";

fn bot_id() -> BotId {
    BotId::parse_uuid_str(BOT_ID).expect("valid bot id")
}

fn user_id(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn timestamp(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .expect("valid timestamp")
        .with_timezone(&Utc)
}

fn team_owner() -> BotOwner {
    BotOwner::Team {
        team_id: Uuid::parse_str(TEAM_ID).expect("valid team id"),
    }
}

fn user_owner() -> BotOwner {
    BotOwner::User {
        user_id: "macro|owner@example.com".to_string(),
    }
}

fn created_metadata() -> BotCreatedMetadata {
    BotCreatedMetadata {
        bot_id: bot_id(),
        kind: BotKind::Owned,
        owner: team_owner(),
        name: "Deploy Bot".to_string(),
        handle: "deploy-bot".to_string(),
        description: None,
        avatar_url: None,
        created_by_user_id: user_id("macro|creator@example.com"),
        channel_id: None,
        created_at: timestamp("2026-07-20T17:01:02Z"),
    }
}

fn updated_metadata() -> BotUpdatedMetadata {
    BotUpdatedMetadata {
        bot_id: bot_id(),
        owner: user_owner(),
        actor_user_id: user_id("macro|editor@example.com"),
        name: None,
        handle: Some("release-bot".to_string()),
        description: Some("Ships releases".to_string()),
        avatar_url: None,
        updated_at: timestamp("2026-07-20T17:03:11Z"),
    }
}

fn deleted_metadata() -> BotDeletedMetadata {
    BotDeletedMetadata {
        bot_id: bot_id(),
        owner: team_owner(),
        actor_user_id: user_id("macro|deleter@example.com"),
    }
}

#[test]
fn created_event_has_exact_sanitized_wire_shape() {
    let event = Event::with_event_id(
        Uuid::parse_str("01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f").expect("valid event id"),
        BotTopicEvent::Created(created_metadata()),
    );

    assert_eq!(
        serde_json::to_value(event).expect("serializable event"),
        json!({
            "event_id": "01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f",
            "schema_version": 1,
            "event_type": "bot.created",
            "metadata": {
                "bot_id": BOT_ID,
                "kind": "owned",
                "owner": { "type": "team", "team_id": TEAM_ID },
                "name": "Deploy Bot",
                "handle": "deploy-bot",
                "description": null,
                "avatar_url": null,
                "created_by_user_id": "macro|creator@example.com",
                "channel_id": null,
                "created_at": "2026-07-20T17:01:02Z",
            },
        })
    );
}

#[test]
fn updated_event_has_exact_sanitized_wire_shape() {
    let event = Event::with_event_id(
        Uuid::parse_str("01998a30-2b3c-7d4e-8f50-6b7c8d9e0f1a").expect("valid event id"),
        BotTopicEvent::Updated(updated_metadata()),
    );

    assert_eq!(
        serde_json::to_value(event).expect("serializable event"),
        json!({
            "event_id": "01998a30-2b3c-7d4e-8f50-6b7c8d9e0f1a",
            "schema_version": 1,
            "event_type": "bot.updated",
            "metadata": {
                "bot_id": BOT_ID,
                "owner": {
                    "type": "user",
                    "user_id": "macro|owner@example.com",
                },
                "actor_user_id": "macro|editor@example.com",
                "name": null,
                "handle": "release-bot",
                "description": "Ships releases",
                "avatar_url": null,
                "updated_at": "2026-07-20T17:03:11Z",
            },
        })
    );
}

#[test]
fn deleted_event_has_exact_wire_shape() {
    let event = Event::with_event_id(
        Uuid::parse_str("01998a30-3c4d-7e5f-8051-7c8d9e0f1a2b").expect("valid event id"),
        BotTopicEvent::Deleted(deleted_metadata()),
    );

    assert_eq!(
        serde_json::to_value(event).expect("serializable event"),
        json!({
            "event_id": "01998a30-3c4d-7e5f-8051-7c8d9e0f1a2b",
            "schema_version": 1,
            "event_type": "bot.deleted",
            "metadata": {
                "bot_id": BOT_ID,
                "owner": { "type": "team", "team_id": TEAM_ID },
                "actor_user_id": "macro|deleter@example.com",
            },
        })
    );
}

#[test]
fn constructors_use_bot_topic_bare_uuid_key_and_schema_version_one() {
    let cases = [
        BotMacroEvent::created(created_metadata()),
        BotMacroEvent::updated(updated_metadata()),
        BotMacroEvent::deleted(deleted_metadata()),
    ];
    let expected_event_types = ["bot.created", "bot.updated", "bot.deleted"];

    for (event, expected_event_type) in cases.into_iter().zip(expected_event_types) {
        assert_eq!(event.key(), BOT_ID);
        assert!(!event.key().starts_with("bot|"));
        assert_eq!(event.topic(), "macro.bots");
        assert_eq!(event.event().schema_version, 1);
        assert_eq!(
            serde_json::to_value(event.event()).expect("serializable event")["event_type"],
            expected_event_type
        );
    }
}

#[test]
fn every_event_variant_round_trips() {
    let cases = [
        BotMacroEvent::created(created_metadata()),
        BotMacroEvent::updated(updated_metadata()),
        BotMacroEvent::deleted(deleted_metadata()),
    ];

    for original in cases {
        let payload = serde_json::to_vec(original.event()).expect("serializable event");
        let decoded = BotMacroEvent::decode(original.key(), &payload).expect("decodable event");

        assert_eq!(decoded.key(), BOT_ID);
        assert_eq!(decoded.event(), original.event());
        assert_eq!(decoded.topic(), "macro.bots");
    }
}

#[test]
fn created_event_serializes_channel_id_when_present() {
    let channel_id =
        Uuid::parse_str("8bfe0c32-5609-47ce-bc54-ef30ab686fb3").expect("valid channel id");
    let mut metadata = created_metadata();
    metadata.channel_id = Some(channel_id);
    metadata.description = Some("Channel automation".to_string());
    metadata.avatar_url = Some("https://example.com/avatar.png".to_string());

    let value =
        serde_json::to_value(BotMacroEvent::created(metadata).event()).expect("serializable event");

    assert_eq!(value["metadata"]["channel_id"], channel_id.to_string());
    assert_eq!(value["metadata"]["description"], "Channel automation");
    assert_eq!(
        value["metadata"]["avatar_url"],
        "https://example.com/avatar.png"
    );
}

#[test]
fn lifecycle_payloads_exclude_token_fields_and_values() {
    let events = [
        BotMacroEvent::created(created_metadata()),
        BotMacroEvent::updated(updated_metadata()),
        BotMacroEvent::deleted(deleted_metadata()),
    ];
    let forbidden_fields = [
        "token",
        "bot_token",
        "bearer_token",
        "token_id",
        "token_hash",
        "token_prefix",
        "token_label",
        "token_expires_at",
        "expires_at",
    ];
    let forbidden_values = ["secret-bot-token", "known-token-hash", "bot_tok_prefix"];

    for event in events {
        let value = serde_json::to_value(event.event()).expect("serializable event");
        let serialized = value.to_string();

        for field in forbidden_fields {
            assert!(!contains_field(&value, field), "payload included {field}");
        }
        for secret in forbidden_values {
            assert!(!serialized.contains(secret), "payload exposed {secret}");
        }
    }
}

fn contains_field(value: &Value, field: &str) -> bool {
    match value {
        Value::Object(object) => {
            object.contains_key(field) || object.values().any(|value| contains_field(value, field))
        }
        Value::Array(values) => values.iter().any(|value| contains_field(value, field)),
        _ => false,
    }
}
