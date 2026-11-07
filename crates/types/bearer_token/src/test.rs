use super::*;

#[test]
fn hashes_utf8_bytes_with_sha256() {
    let hash = hash_token("mbot_abc_secret");
    let expected: [u8; 32] = Sha256::digest(b"mbot_abc_secret").into();
    assert_eq!(hash, expected);
    assert_ne!(hash, hash_token("mbot_abc_other"));
}

#[test]
fn bot_prefix_uses_mbot_segment() {
    assert_eq!(
        token_prefix::<Bot>("mbot_aabbccddeeff_aabbccddeeffrest"),
        "mbot_aabbccddeeff"
    );
}

#[test]
fn harness_prefix_uses_mhns_segment() {
    assert_eq!(
        token_prefix::<Harness>("mhns_aabbccddeeff_aabbccddeeffrest"),
        "mhns_aabbccddeeff"
    );
}

#[test]
fn a_token_of_another_family_gets_the_hash_fallback() {
    let harness_token = "mhns_aabbccddeeff_aabbccddeeffrest";
    let prefix = token_prefix::<Bot>(harness_token);
    assert_eq!(prefix.len(), 12);
    assert!(!prefix.starts_with("mhns"));
}

#[test]
fn a_prefix_without_its_separator_gets_the_hash_fallback() {
    assert_eq!(token_prefix::<Bot>("mbotaabb_secret").len(), 12);
}

#[test]
fn unshaped_tokens_use_the_first_12_hex_chars_of_the_hash() {
    let leftover = "550e8400-e29b-41d4-a716-446655440000";
    let expected = hash_token(leftover)
        .into_iter()
        .take(6)
        .fold(String::new(), |mut out, byte| {
            use std::fmt::Write;
            let _ = write!(out, "{byte:02x}");
            out
        });
    assert_eq!(token_prefix::<Bot>(leftover), expected);
    assert_eq!(token_prefix::<Harness>(leftover), expected);
    assert_eq!(token_prefix::<Bot>("short").len(), 12);
    assert_ne!(token_prefix::<Bot>("short"), "short");
}

#[test]
fn hashed_token_does_not_retain_the_raw_secret() {
    let raw = "mbot_aabbccddeeff_aabbccddeeffsecret";
    let hashed = HashedBotToken::from_raw(raw);
    assert_eq!(hashed.hash, hash_token(raw));
    assert_eq!(hashed.prefix, "mbot_aabbccddeeff");
    assert_ne!(hashed.prefix, raw);

    let harness = HashedHarnessToken::from_raw("mhns_aabbccddeeff_secret");
    assert_eq!(harness.prefix, "mhns_aabbccddeeff");
}
