use super::*;

const FLAG: &str = "ENABLE_AI_USAGE_ENFORCEMENT";

#[test]
fn missing_flag_is_off() {
    assert!(!parse_startup_flag(FLAG, None).unwrap());
}

#[test]
fn explicit_boolean_values_select_policy() {
    assert!(!parse_startup_flag(FLAG, Some("false")).unwrap());
    assert!(parse_startup_flag(FLAG, Some("true")).unwrap());
}

#[test]
fn malformed_present_values_are_errors_not_disabled_defaults() {
    for value in [
        "", "TRUE", "False", "1", "0", "yes", " true", "false\n", "garbage", "null",
    ] {
        let error = parse_startup_flag(FLAG, Some(value)).unwrap_err();
        assert!(error.to_string().contains(FLAG), "{error}");
    }
}

#[test]
fn errors_name_the_flag_being_parsed() {
    let error = parse_startup_flag("ENABLE_AI_USAGE_BILLING", Some("maybe")).unwrap_err();
    assert!(
        error.to_string().contains("ENABLE_AI_USAGE_BILLING"),
        "{error}"
    );
}

#[test]
fn deserialized_booleans_select_enforcement() {
    assert_eq!(
        serde_json::from_value::<AiUsageEnforcement>(serde_json::json!(true)).unwrap(),
        AiUsageEnforcement::Enabled
    );
    assert_eq!(
        serde_json::from_value::<AiUsageEnforcement>(serde_json::json!(false)).unwrap(),
        AiUsageEnforcement::Disabled
    );
    assert!(serde_json::from_value::<AiUsageEnforcement>(serde_json::json!("true")).is_err());
}
