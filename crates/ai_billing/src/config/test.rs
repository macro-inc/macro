use super::*;

#[test]
fn deserialized_booleans_select_settlement_policy() {
    assert_eq!(
        serde_json::from_value::<AiUsageBilling>(serde_json::json!(true)).unwrap(),
        AiUsageBilling::Enabled
    );
    assert_eq!(
        serde_json::from_value::<AiUsageBilling>(serde_json::json!(false)).unwrap(),
        AiUsageBilling::Disabled
    );
    for value in [
        serde_json::json!("true"),
        serde_json::json!(1),
        serde_json::json!(null),
    ] {
        assert!(serde_json::from_value::<AiUsageBilling>(value).is_err());
    }
}

#[test]
fn default_policy_is_disabled() {
    assert_eq!(AiUsageBilling::default(), AiUsageBilling::Disabled);
    assert!(!AiUsageBilling::Disabled.is_enabled());
    assert!(AiUsageBilling::Enabled.is_enabled());
}
