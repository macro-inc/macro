use super::*;

#[test]
fn allow_all_accepts_public_signups() {
    let policy = SignupPolicy::allow_all();

    assert!(
        policy
            .authorize_public_email("new.user@example.test")
            .is_ok()
    );
}

#[test]
fn allowlist_matching_trims_and_ignores_case() {
    let policy = SignupPolicy::from_allowlist_json(
        r#"[" User.One@Example.Test ", "second.user@example.test"]"#,
    )
    .expect("valid allowlist");

    assert_eq!(policy.allowed_email_count(), Some(2));
    assert!(
        policy
            .authorize_public_email("user.one@example.test")
            .is_ok()
    );
    assert!(
        policy
            .authorize_public_email(" USER.ONE@EXAMPLE.TEST ")
            .is_ok()
    );
    assert!(
        policy
            .authorize_public_email("second.user@EXAMPLE.TEST")
            .is_ok()
    );
}

#[test]
fn duplicate_allowlist_entries_are_collapsed() {
    let policy = SignupPolicy::from_allowlist_json(
        r#"["duplicate@example.test", " DUPLICATE@example.test "]"#,
    )
    .expect("valid allowlist");

    assert_eq!(policy.allowed_email_count(), Some(1));
    assert!(!format!("{policy:?}").contains("duplicate@example.test"));
}

#[test]
fn plus_aliases_remain_distinct_addresses() {
    let policy =
        SignupPolicy::from_allowlist_json(r#"["person@example.test"]"#).expect("valid allowlist");

    assert!(policy.authorize_public_email("person@example.test").is_ok());
    assert_eq!(
        policy.authorize_public_email("person+trial@example.test"),
        Err(SignupPolicyDenial::PublicEmailNotAllowed)
    );
}

#[test]
fn allowlist_policy_accepts_macro_domain_addresses() {
    let policy =
        SignupPolicy::from_allowlist_json(r#"["person@example.test"]"#).expect("valid allowlist");

    assert!(policy.authorize_public_email("new.user@macro.com").is_ok());
    assert!(
        policy
            .authorize_public_email(" NEW.USER@MACRO.COM ")
            .is_ok()
    );
    assert!(
        policy
            .authorize_public_email("new.user+trial@macro.com")
            .is_ok()
    );
}

#[test]
fn macro_domain_match_does_not_include_subdomains_or_similar_domains() {
    let policy =
        SignupPolicy::from_allowlist_json(r#"["person@example.test"]"#).expect("valid allowlist");

    for email in [
        "person@dev.macro.com",
        "person@notmacro.com",
        "person@macro.com.example.test",
    ] {
        assert_eq!(
            policy.authorize_public_email(email),
            Err(SignupPolicyDenial::PublicEmailNotAllowed),
            "{email}"
        );
    }
}

#[test]
fn malformed_json_is_rejected() {
    assert_eq!(
        SignupPolicy::from_allowlist_json("not json"),
        Err(SignupPolicyConfigError::MalformedJson)
    );
}

#[test]
fn non_array_json_is_rejected() {
    assert_eq!(
        SignupPolicy::from_allowlist_json(r#"{"email":"person@example.test"}"#),
        Err(SignupPolicyConfigError::ExpectedArray)
    );
}

#[test]
fn non_string_entries_are_rejected_by_index() {
    assert_eq!(
        SignupPolicy::from_allowlist_json(r#"["person@example.test", 42]"#),
        Err(SignupPolicyConfigError::NonStringEntry { index: 1 })
    );
}

#[test]
fn invalid_emails_are_rejected_by_index() {
    assert_eq!(
        SignupPolicy::from_allowlist_json(r#"["person@example.test", "not-an-email"]"#),
        Err(SignupPolicyConfigError::InvalidEmail { index: 1 })
    );
}

#[test]
fn blank_entries_are_rejected_by_index() {
    assert_eq!(
        SignupPolicy::from_allowlist_json(r#"["person@example.test", "   "]"#),
        Err(SignupPolicyConfigError::BlankEntry { index: 1 })
    );
}

#[test]
fn empty_arrays_are_rejected() {
    assert_eq!(
        SignupPolicy::from_allowlist_json("[]"),
        Err(SignupPolicyConfigError::EmptyAllowlist)
    );
}

#[test]
fn diagnostics_do_not_reveal_allowlist_or_denied_email() {
    let policy = SignupPolicy::from_allowlist_json(r#"["secret-address@example.test"]"#)
        .expect("valid allowlist");
    let denial = policy
        .authorize_public_email("denied-address@example.test")
        .expect_err("email should be denied");

    let policy_debug = format!("{policy:?}");
    let denial_debug = format!("{denial:?}");
    let denial_display = denial.to_string();

    for diagnostic in [policy_debug, denial_debug, denial_display] {
        assert!(!diagnostic.contains("secret-address@example.test"));
        assert!(!diagnostic.contains("denied-address@example.test"));
    }
}

#[test]
fn config_errors_do_not_reveal_entries() {
    let error = SignupPolicy::from_allowlist_json(r#"["not-an-email"]"#)
        .expect_err("invalid entry should fail");

    let debug = format!("{error:?}");
    let display = error.to_string();

    assert!(!debug.contains("not-an-email"));
    assert!(!display.contains("not-an-email"));
}
