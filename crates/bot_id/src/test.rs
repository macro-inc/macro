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
fn system_bot_id_is_stable_and_distinct_from_ai_personas() {
    assert_eq!(
        MACRO_SYSTEM_BOT_ID.into_storage_id().as_ref(),
        "bot|00000000-0000-0000-0000-000000005759"
    );
    assert_ne!(MACRO_SYSTEM_BOT_ID, MACRO_AI_BOT_ID);
    assert_ne!(MACRO_SYSTEM_BOT_ID, MACRO_CODER_BOT_ID);
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

#[test]
fn hashes_utf8_bytes_with_sha256() {
    use sha2::{Digest, Sha256};

    let hash = hash_token("mbot_abc_secret");
    let expected: [u8; 32] = Sha256::digest(b"mbot_abc_secret").into();
    assert_eq!(hash, expected);
    assert_ne!(hash, hash_token("mbot_abc_other"));
}

#[test]
fn token_prefix_uses_mbot_segment_or_hash_fallback() {
    assert_eq!(
        token_prefix("mbot_aabbccddeeff_aabbccddeeffrest"),
        "mbot_aabbccddeeff"
    );

    let leftover = "550e8400-e29b-41d4-a716-446655440000";
    let leftover_prefix = token_prefix(leftover);
    assert_eq!(leftover_prefix.len(), 12);
    assert_ne!(leftover_prefix, leftover);
    assert_eq!(
        leftover_prefix,
        hash_token(leftover)
            .into_iter()
            .take(6)
            .fold(String::new(), |mut out, byte| {
                use std::fmt::Write;
                let _ = write!(out, "{byte:02x}");
                out
            })
    );

    assert_eq!(token_prefix("short").len(), 12);
    assert_ne!(token_prefix("short"), "short");
}

#[test]
fn hashed_bot_token_does_not_retain_the_raw_secret() {
    let raw = "mbot_aabbccddeeff_aabbccddeeffsecret";
    let hashed = HashedBotToken::from_raw(raw);
    assert_eq!(hashed.hash, hash_token(raw));
    assert_eq!(hashed.prefix, "mbot_aabbccddeeff");
    assert_ne!(hashed.prefix, raw);

    let short = HashedBotToken::from_raw("short");
    assert_ne!(short.prefix, "short");
    assert_eq!(short.hash, hash_token("short"));
}
