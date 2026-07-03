use super::*;

#[test]
fn storage_string_round_trips() {
    let uuid = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(uuid);

    assert_eq!(
        BotIdStr::parse_from_str(bot_id.into_storage_id().as_ref())
            .unwrap()
            .bot_id(),
        bot_id
    );
}

#[test]
fn bot_id_str_parses_storage_string() {
    let uuid = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(uuid);
    let storage = format!("bot|{uuid}");

    let parsed = BotIdStr::parse_from_str(&storage).unwrap();

    assert_eq!(parsed.bot_id(), bot_id);
    assert_eq!(parsed.as_uuid(), uuid);
    assert_eq!(parsed.bot_id().as_uuid().to_string(), uuid.to_string());
    assert_eq!(parsed.as_ref(), storage);
}

#[test]
fn bot_id_str_from_bot_id_creates_storage_string() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let storage = BotIdStr::from(bot_id);

    assert_eq!(storage.bot_id(), bot_id);
    assert_eq!(storage.to_string(), format!("bot|{bot_id}"));
}

#[test]
fn rejects_non_bot_storage_string() {
    assert!(BotIdStr::parse_from_str("macro|teo@macro.com").is_err());
}

#[test]
fn rejects_trailing_storage_content() {
    let uuid = Uuid::new_v4();

    assert!(BotIdStr::parse_from_str(&format!("bot|{uuid}|extra")).is_err());
}

#[test]
fn rejects_non_canonical_storage_uuid() {
    let uuid = Uuid::new_v4().simple().to_string();

    assert!(BotIdStr::parse_from_str(&format!("bot|{uuid}")).is_err());
}
