use super::*;

#[test]
fn missing_flag_disables_enforcement() {
    assert_eq!(
        parse_enforcement(None).unwrap(),
        AiUsageEnforcement::Disabled
    );
}

#[test]
fn explicit_boolean_values_select_policy() {
    assert_eq!(
        parse_enforcement(Some("false")).unwrap(),
        AiUsageEnforcement::Disabled
    );
    assert_eq!(
        parse_enforcement(Some("true")).unwrap(),
        AiUsageEnforcement::Enabled
    );
}

#[test]
fn malformed_present_values_are_errors_not_disabled_defaults() {
    for value in [
        "", "TRUE", "False", "1", "0", "yes", " true", "false\n", "garbage",
    ] {
        let error = parse_enforcement(Some(value)).unwrap_err();
        assert!(
            error.to_string().contains("ENABLE_AI_USAGE_ENFORCEMENT"),
            "{error}"
        );
    }
}
