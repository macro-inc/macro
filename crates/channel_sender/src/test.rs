use macro_user_id::email::ReadEmailParts;
use uuid::Uuid;

use super::*;

#[test]
fn sender_round_trips_user_storage_string() {
    let sender = ChannelSender::parse_from_str("macro|alice@example.com").unwrap();

    assert_eq!(sender.as_ref(), "macro|alice@example.com");
    assert!(matches!(sender.0, InnerVal::Right(_)));
}

#[test]
fn sender_round_trips_bot_storage_string() {
    let id = Uuid::new_v4();
    let storage = format!("bot|{id}");
    let sender = ChannelSender::parse_from_str(&storage).unwrap();

    assert_eq!(sender.as_ref(), storage);
    let serialized = serde_json::to_value(&sender).unwrap();
    assert_eq!(serialized, storage);

    let deserialized: ChannelSender<'static> = serde_json::from_value(serialized).unwrap();
    assert_eq!(deserialized.as_ref(), storage);
    assert!(matches!(deserialized.0, InnerVal::Left(_)));
}

#[test]
fn fallback_user_name_uses_email_local_part() {
    let user_id = MacroUserIdStr::parse_from_str("macro|shepherd.hatton@gmail.com").unwrap();

    assert_eq!(user_id.email_part().local_part(), "shepherd.hatton");
}
