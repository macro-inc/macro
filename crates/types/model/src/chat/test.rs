use model_owner::Owner;
use serde_json::json;

use super::{Chat, ChatBasic};

const USER_OWNER: &str = "macro|test@example.com";
const BOT_OWNER: &str = "bot|00000000-0000-0000-0000-00000000a1a1";
const TEAM_OWNER: &str = "01234567-89ab-cdef-0123-456789abcdef";

fn owner(principal: &str) -> Owner {
    Owner::from_principal_str(principal).unwrap()
}

fn chat(principal: &str) -> Chat {
    Chat {
        id: "chat-1".to_string(),
        name: "Test Chat".to_string(),
        user_id: owner(principal),
        model: Some("anthropic/claude".to_string()),
        project_id: None,
        created_at: None,
        updated_at: None,
        token_count: Some(10),
        is_persistent: true,
        deleted_at: None,
    }
}

#[test]
fn chat_serializes_owner_as_user_id_string() {
    let serialized = serde_json::to_value(chat(USER_OWNER)).unwrap();

    assert_eq!(serialized["userId"], USER_OWNER);
    assert!(serialized.get("user_id").is_none());
}

#[test]
fn chat_round_trips_every_owner_kind() {
    for principal in [USER_OWNER, BOT_OWNER, TEAM_OWNER] {
        let original = chat(principal);
        let serialized = serde_json::to_value(&original).unwrap();
        assert_eq!(serialized["userId"], principal);

        let deserialized: Chat = serde_json::from_value(serialized).unwrap();
        assert_eq!(deserialized, original);
    }
}

fn chat_from_wire(principal: &str) -> Chat {
    serde_json::from_value(json!({
        "id": "chat-1",
        "name": "Test Chat",
        "userId": principal,
        "isPersistent": false,
    }))
    .unwrap()
}

#[test]
fn chat_deserializes_bot_and_team_owner_principals() {
    let bot = chat_from_wire(BOT_OWNER);
    assert_eq!(bot.user_id, owner(BOT_OWNER));
    assert!(matches!(bot.user_id, Owner::Bot(_)));

    let team = chat_from_wire(TEAM_OWNER);
    assert_eq!(team.user_id, owner(TEAM_OWNER));
    assert!(matches!(team.user_id, Owner::Team(_)));
}

#[test]
fn chat_rejects_malformed_owner_principal() {
    let result = serde_json::from_value::<Chat>(json!({
        "id": "chat-1",
        "name": "Test Chat",
        "userId": "user1",
        "isPersistent": false,
    }));

    assert!(result.is_err());
}

#[test]
fn chat_basic_round_trips_non_user_owner() {
    let original = ChatBasic {
        id: "chat-1".to_string(),
        name: "Test Chat".to_string(),
        user_id: owner(BOT_OWNER),
        project_id: Some("project-1".to_string()),
        deleted_at: None,
    };

    let serialized = serde_json::to_value(&original).unwrap();
    assert_eq!(serialized["user_id"], BOT_OWNER);

    let deserialized: ChatBasic = serde_json::from_value(serialized).unwrap();
    assert_eq!(deserialized, original);
}
