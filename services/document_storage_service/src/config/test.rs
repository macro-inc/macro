use super::*;

#[test]
fn missing_or_false_gate_disables_non_user_owners() {
    assert_eq!(
        parse_non_user_owners(None).unwrap(),
        NonUserOwners::Disabled
    );
    assert_eq!(
        parse_non_user_owners(Some("false")).unwrap(),
        NonUserOwners::Disabled
    );
}

#[test]
fn true_gate_enables_non_user_owners() {
    assert_eq!(
        parse_non_user_owners(Some("true")).unwrap(),
        NonUserOwners::Enabled
    );
}

#[test]
fn invalid_gate_value_is_rejected() {
    let error = parse_non_user_owners(Some("yes")).unwrap_err();

    assert_eq!(
        error.to_string(),
        "ENABLE_NON_USER_OWNERS must be `true` or `false`"
    );
}
