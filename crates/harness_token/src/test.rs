use super::*;

#[test]
fn hashes_utf8_bytes_with_sha256() {
    use sha2::{Digest, Sha256};

    let hash = hash_token("mhns_abc_secret");
    let expected: [u8; 32] = Sha256::digest(b"mhns_abc_secret").into();
    assert_eq!(hash, expected);
    assert_ne!(hash, hash_token("mhns_abc_other"));
}

#[test]
fn token_prefix_uses_mhns_segment_or_hash_fallback() {
    assert_eq!(
        token_prefix("mhns_aabbccddeeff_aabbccddeeffrest"),
        "mhns_aabbccddeeff"
    );

    let leftover = "550e8400-e29b-41d4-a716-446655440000";
    let leftover_prefix = token_prefix(leftover);
    assert_eq!(leftover_prefix.len(), 12);
    assert_ne!(leftover_prefix, leftover);

    assert_eq!(token_prefix("short").len(), 12);
    assert_ne!(token_prefix("short"), "short");
}

#[test]
fn hashed_harness_token_does_not_retain_the_raw_secret() {
    let raw = "mhns_aabbccddeeff_aabbccddeeffsecret";
    let hashed = HashedHarnessToken::from_raw(raw);
    assert_eq!(hashed.hash, hash_token(raw));
    assert_eq!(hashed.prefix, "mhns_aabbccddeeff");
    assert_ne!(hashed.prefix, raw);
}
