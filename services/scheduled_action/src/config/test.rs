use super::*;
use serde_json::{Value, json};

fn config_values() -> Value {
    json!({
        "ENVIRONMENT": "local",
        "DATABASE_URL": "postgres://localhost/macro",
        "KAFKA_BROKERS": "existing-broker:9092",
        "INTERNAL_API_KEY": "test",
        "AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS": 500,
        "AI_USAGE_INCLUDED_ALLOWANCE_CENTS": 2000,
        "AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS": 10000,
        "AI_USAGE_OVERAGE_MARKUP_PERCENT": 5
    })
}

#[test]
fn ai_pricing_is_mandatory_and_validated() {
    use ai_billing::PlanTier;

    let config: Config = serde_json::from_value(config_values()).unwrap();
    let pricing = config.ai_pricing();
    assert_eq!(pricing.included_allowance_cents_for(PlanTier::Free), 500);
    assert_eq!(
        pricing.included_allowance_cents_for(PlanTier::Premium),
        2_000
    );
    assert_eq!(pricing.included_allowance_cents_for(PlanTier::Max), 10_000);
    assert_eq!(pricing.overage_markup_percent(), 5);
    for key in [
        "AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS",
        "AI_USAGE_INCLUDED_ALLOWANCE_CENTS",
        "AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS",
        "AI_USAGE_OVERAGE_MARKUP_PERCENT",
    ] {
        let mut values = config_values();
        values.as_object_mut().unwrap().remove(key);
        assert!(
            serde_json::from_value::<Config>(values).is_err(),
            "{key} must be mandatory"
        );
    }
    let mut values = config_values();
    values["AI_USAGE_OVERAGE_MARKUP_PERCENT"] = json!(100);
    assert!(serde_json::from_value::<Config>(values).is_err());
}

#[test]
fn ai_usage_enforcement_defaults_off_and_requires_a_boolean() {
    let config: Config = serde_json::from_value(config_values()).unwrap();
    assert_eq!(
        config.enable_ai_usage_enforcement,
        ai_usage::AiUsageEnforcement::Disabled
    );
    for (value, expected) in [
        (false, ai_usage::AiUsageEnforcement::Disabled),
        (true, ai_usage::AiUsageEnforcement::Enabled),
    ] {
        let mut values = config_values();
        values["ENABLE_AI_USAGE_ENFORCEMENT"] = json!(value);
        let config: Config = serde_json::from_value(values).unwrap();
        assert_eq!(config.enable_ai_usage_enforcement, expected);
    }
    for value in [json!("enabled"), json!(1)] {
        let mut values = config_values();
        values["ENABLE_AI_USAGE_ENFORCEMENT"] = value;
        assert!(serde_json::from_value::<Config>(values).is_err());
    }
}

#[test]
fn settlement_requests_need_billing_on_and_the_authentication_key() {
    use ai_billing::composition::SettlementRoute;

    // Default: billing off, no key, nothing requested.
    let config: Config = serde_json::from_value(config_values()).unwrap();
    assert_eq!(
        config.enable_ai_usage_billing,
        ai_billing::AiUsageBilling::Disabled
    );
    assert!(matches!(
        config.settlement_route().unwrap(),
        SettlementRoute::Off
    ));

    // A key without billing is accepted and unused.
    let mut values = config_values();
    values["AUTHENTICATION_SERVICE_SECRET_KEY"] = json!("auth-key");
    let config: Config = serde_json::from_value(values).unwrap();
    assert!(matches!(
        config.settlement_route().unwrap(),
        SettlementRoute::Off
    ));

    // Billing is loaded like enforcement: a raw boolean, once, at startup.
    let mut values = config_values();
    values["ENABLE_AI_USAGE_BILLING"] = json!(true);
    let mut config: Config = serde_json::from_value(values).unwrap();
    assert_eq!(
        config.enable_ai_usage_billing,
        ai_billing::AiUsageBilling::Enabled
    );
    // Billing without the key is a startup error, not a silent downgrade.
    assert!(config.settlement_route().is_err());
    config.authentication_service_secret_key = serde_json::from_value(json!("auth-key")).unwrap();
    assert!(matches!(
        config.settlement_route().unwrap(),
        SettlementRoute::AuthService(_)
    ));

    let mut values = config_values();
    values["ENABLE_AI_USAGE_BILLING"] = json!("enabled");
    assert!(serde_json::from_value::<Config>(values).is_err());
}

#[test]
fn event_routines_default_off_and_reuse_existing_brokers() {
    let config: Config = serde_json::from_value(config_values()).unwrap();
    assert!(!config.event_routines_enabled);
    assert!(!config.routine_agents_enabled);
    assert_eq!(config.kafka_brokers.to_string(), "existing-broker:9092");
}

#[test]
fn routine_agents_require_an_explicit_boolean() {
    for enabled in [false, true] {
        let mut values = config_values();
        values["ROUTINE_AGENTS_ENABLED"] = json!(enabled);
        let config: Config = serde_json::from_value(values).unwrap();
        assert_eq!(config.routine_agents_enabled, enabled);
    }
    let mut values = config_values();
    values["ROUTINE_AGENTS_ENABLED"] = json!("enabled");
    assert!(serde_json::from_value::<Config>(values).is_err());
}

#[test]
fn event_routines_require_an_explicit_boolean() {
    for enabled in [false, true] {
        let mut values = config_values();
        values["EVENT_ROUTINES_ENABLED"] = json!(enabled);
        let config: Config = serde_json::from_value(values).unwrap();
        assert_eq!(config.event_routines_enabled, enabled);
    }
    let mut values = config_values();
    values["EVENT_ROUTINES_ENABLED"] = json!("enabled");
    assert!(serde_json::from_value::<Config>(values).is_err());
}

#[test]
fn the_typesafe_key_is_optional() {
    let config: Config = serde_json::from_value(config_values()).unwrap();
    assert_eq!(config.typesafe_api_key.value(), None);
    let mut values = config_values();
    values["TYPESAFE_API_KEY"] = json!("ts-key");
    let config: Config = serde_json::from_value(values).unwrap();
    assert_eq!(config.typesafe_api_key.value(), Some("ts-key"));
}
