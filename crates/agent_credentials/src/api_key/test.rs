use super::*;

#[test]
fn accepts_current_user_keys_but_rejects_legacy_or_malformed_agent_keys() {
    let raw = UserApiKey::generate();
    let key = AgentApiKey::parse(raw.expose().to_owned()).expect("current key");
    assert_eq!(key.expose(), raw.expose());
    assert_eq!(format!("{key:?}"), "AgentApiKey(redacted)");
    let json = serde_json::to_string(&key).expect("serialize key");
    assert_eq!(json, format!("\"{}\"", raw.expose()));
    assert_eq!(
        serde_json::from_str::<AgentApiKey>(&json).expect("valid key"),
        key
    );
    for raw in ["", "legacy-key", "mak_short", "mrt_wrong-prefix"] {
        assert!(AgentApiKey::parse(raw.to_owned()).is_err());
        assert!(serde_json::from_value::<AgentApiKey>(serde_json::json!(raw)).is_err());
    }
    assert!(AgentApiKey::parse(format!("mak_{}", "g".repeat(64))).is_err());
    assert!(AgentApiKey::parse(format!("mak_{}", "a".repeat(65))).is_err());
}
