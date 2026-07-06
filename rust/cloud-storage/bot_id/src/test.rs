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

#[test]
fn equality_and_hash_ignore_uuid_case() {
    let lowercase = "bot|0a0b0c0d-0000-0000-0000-00000000a1a1".to_string();
    let uppercase = "bot|0A0B0C0D-0000-0000-0000-00000000A1A1".to_string();

    let lower = BotIdStr::parse_from_str(&lowercase).unwrap();
    let upper = BotIdStr::parse_from_str(&uppercase).unwrap();

    // Different original strings, same bot: equal and hash-compatible.
    assert_eq!(lower, upper);
    assert_eq!(lower.bot_id(), upper.bot_id());

    let set: std::collections::HashSet<BotIdStr<'_>> =
        [lower.clone(), upper.clone()].into_iter().collect();
    assert_eq!(set.len(), 1);
}
