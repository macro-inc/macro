use super::*;
use crate::domain::models::MutatedMessage;
use bot_id::BotId;
use chrono::Utc;

fn message(sender_id: Sender) -> MutatedMessage {
    let now = Utc::now();
    MutatedMessage {
        id: Uuid::new_v4(),
        channel_id: Uuid::new_v4(),
        thread_id: None,
        sender_id,
        content: "hello".to_string(),
        created_at: now,
        updated_at: now,
        edited_at: None,
        deleted_at: None,
    }
}

#[test]
fn bot_message_payload_includes_enriched_sender() {
    let bot_id = BotId::from_uuid(Uuid::new_v4());
    let message = message(Sender::Bot(bot_id));
    let sender = MessageRealtimeSender::new(
        &message.sender_id,
        Some(BotSenderProfile {
            name: "Deploy Bot".to_string(),
            avatar_url: Some("https://example.com/bot.png".to_string()),
        }),
    );

    let payload = serde_json::to_value(WithNonce {
        data: MessageRealtimeData { message, sender },
        nonce: Some("nonce-1".to_string()),
    })
    .unwrap();

    // Flattened message fields stay at the top level for existing clients.
    assert_eq!(payload["sender_id"], bot_id.to_storage_string());
    assert_eq!(payload["content"], "hello");
    assert_eq!(payload["nonce"], "nonce-1");
    assert_eq!(payload["sender"]["type"], "bot");
    assert_eq!(payload["sender"]["id"], bot_id.as_uuid().to_string());
    assert_eq!(payload["sender"]["name"], "Deploy Bot");
    assert_eq!(
        payload["sender"]["avatar_url"],
        "https://example.com/bot.png"
    );
}

#[test]
fn user_message_payload_omits_bot_fields() {
    let user = macro_user_id::user_id::MacroUserIdStr::try_from_email("alice@example.com")
        .expect("valid email");
    let message = message(Sender::User(user.clone()));
    let sender = MessageRealtimeSender::new(&message.sender_id, None);

    let payload = serde_json::to_value(WithNonce {
        data: MessageRealtimeData { message, sender },
        nonce: None,
    })
    .unwrap();

    assert_eq!(payload["sender"]["type"], "user");
    assert_eq!(payload["sender"]["id"], user.as_ref());
    assert!(payload["sender"].get("name").is_none());
    assert!(payload["sender"].get("avatar_url").is_none());
    assert!(payload.get("nonce").is_none());
}
