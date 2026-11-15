use super::*;

#[test]
fn rejects_malformed_tokens_and_hashes_including_serde() {
    for raw in ["", "weak", "mrt_", "mak_012345", "mrt_abcdef/"] {
        assert!(RepoToken::parse(raw.to_owned()).is_err());
        assert!(serde_json::from_value::<RepoToken>(serde_json::json!(raw)).is_err());
        assert!(RepoTokenHash::from_stored(raw.to_owned()).is_err());
        assert!(serde_json::from_value::<RepoTokenHash>(serde_json::json!(raw)).is_err());
    }
    assert!(RepoToken::parse(format!("mrt_{}", "a".repeat(63))).is_err());
    assert!(RepoToken::parse(format!("mrt_{}", "g".repeat(64))).is_err());
    assert!(RepoTokenHash::from_stored("g".repeat(64)).is_err());
    for raw in [
        format!("mrt_{}", "A".repeat(64)),
        format!("mrt_{}\n", "a".repeat(64)),
    ] {
        assert!(RepoToken::parse(raw).is_err());
    }
}

#[test]
fn preserves_token_wire_format_and_hides_debug() {
    let token = RepoToken::generate();
    let json = serde_json::to_string(&token).expect("serialize token");
    assert_eq!(json, format!("\"{}\"", token.expose()));
    let restored: RepoToken = serde_json::from_str(&json).expect("valid token");
    assert_eq!(token.hash(), restored.hash());
    assert_eq!(format!("{token:?}"), "RepoToken(redacted)");
    let digest = token.hash();
    assert_eq!(format!("{digest:?}"), "RepoTokenHash(redacted)");
    assert!(RepoTokenHash::from_stored(digest.as_str().to_uppercase()).is_err());
    assert!(digest.matches(&restored.hash()));
    assert_ne!(digest, RepoToken::generate().hash());
    assert_ne!(token.hash(), RepoToken::generate().hash());
}
