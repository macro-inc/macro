use super::*;

const CUSTOMER_STORAGE_ERROR: &str = "sentinel customer storage error";

fn customer_storage_error() -> CustomerError {
    CustomerError::StorageLayerError(anyhow::anyhow!(CUSTOMER_STORAGE_ERROR))
}

fn assert_preserves_customer_storage_error(error: impl std::fmt::Display) {
    let message = error.to_string();
    assert!(
        message.contains(CUSTOMER_STORAGE_ERROR),
        "customer storage error was missing from: {message}"
    );
}

fn team_with_enterprise_status(enterprise: bool) -> Team {
    Team::new(
        uuid::Uuid::nil(),
        "Test Team".to_string(),
        "TEST_TEAM".to_string(),
        MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
        false,
        enterprise,
    )
}

#[test]
fn team_enterprise_accessor_preserves_constructor_value() {
    for enterprise in [false, true] {
        assert_eq!(
            team_with_enterprise_status(enterprise).enterprise(),
            enterprise
        );
    }
}

#[test]
fn serialized_team_preserves_enterprise_value() {
    for enterprise in [false, true] {
        let serialized = serde_json::to_value(team_with_enterprise_status(enterprise)).unwrap();

        assert_eq!(serialized["enterprise"], enterprise);
    }
}

#[test]
fn invite_users_to_team_error_preserves_customer_storage_error() {
    let error = InviteUsersToTeamError::from(customer_storage_error());
    assert_preserves_customer_storage_error(error);
}

#[test]
fn remove_user_from_team_error_preserves_customer_storage_error() {
    let error = RemoveUserFromTeamError::from(customer_storage_error());
    assert_preserves_customer_storage_error(error);
}

#[test]
fn remove_team_invite_error_preserves_customer_storage_error() {
    let error = RemoveTeamInviteError::from(customer_storage_error());
    assert_preserves_customer_storage_error(error);
}

#[test]
fn delete_team_error_preserves_customer_storage_error() {
    let error = DeleteTeamError::from(customer_storage_error());
    assert_preserves_customer_storage_error(error);
}

#[test]
fn join_team_error_preserves_customer_storage_error() {
    let error = JoinTeamError::from(customer_storage_error());
    assert_preserves_customer_storage_error(error);
}

#[test]
fn team_checkout_error_preserves_customer_storage_error() {
    let error = TeamCheckoutError::from(customer_storage_error());
    assert_preserves_customer_storage_error(error);
}

#[test]
fn generic_email_domains_are_lowercase_and_sorted() {
    // is_generic_email_domain binary searches the list, which is only
    // correct when the entries are sorted (and lowercase, since lookups
    // are lowercased).
    assert!(GENERIC_EMAIL_DOMAINS.is_sorted());
    assert!(
        GENERIC_EMAIL_DOMAINS
            .iter()
            .all(|domain| *domain == domain.to_ascii_lowercase())
    );
}

#[test]
fn is_generic_email_domain_matches_generic_providers() {
    assert!(is_generic_email_domain("gmail.com"));
    assert!(is_generic_email_domain("hotmail.co.uk"));
    assert!(is_generic_email_domain("zoho.com"));
    assert!(is_generic_email_domain("126.com"));
}

#[test]
fn is_generic_email_domain_is_case_insensitive() {
    assert!(is_generic_email_domain("GMAIL.COM"));
    assert!(is_generic_email_domain("Outlook.Com"));
}

#[test]
fn is_generic_email_domain_allows_company_domains() {
    assert!(!is_generic_email_domain("macro.com"));
    assert!(!is_generic_email_domain("example.org"));
    assert!(!is_generic_email_domain("gmail.com.evil.com"));
}
