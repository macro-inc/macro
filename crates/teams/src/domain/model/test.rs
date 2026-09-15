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
fn new_team_defaults_link_share_to_team() {
    let team = team_with_enterprise_status(false);
    assert_eq!(team.default_link_share(), Some(LinkShare::Team));

    let serialized = serde_json::to_value(team).unwrap();
    assert_eq!(serialized["default_link_share"], "TEAM");
}

#[test]
fn patch_team_request_distinguishes_omitted_and_null_default_link_share() {
    let omitted: PatchTeamRequest = serde_json::from_str("{}").unwrap();
    assert_eq!(omitted.default_link_share, None);

    let null: PatchTeamRequest = serde_json::from_str(r#"{"default_link_share": null}"#).unwrap();
    assert_eq!(null.default_link_share, Some(None));

    let set: PatchTeamRequest =
        serde_json::from_str(r#"{"default_link_share": "PUBLIC"}"#).unwrap();
    assert_eq!(set.default_link_share, Some(Some(LinkShare::Public)));
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

#[test]
fn startup_type_wire_values_round_trip_through_serde_and_from_str() {
    for variant in StartupType::ALL {
        let json = serde_json::to_value(variant).unwrap();
        assert_eq!(
            json,
            variant.as_str(),
            "serde form must equal the storage form"
        );
        assert_eq!(variant.as_str().parse::<StartupType>().unwrap(), variant);
        assert_eq!(
            serde_json::from_value::<StartupType>(json).unwrap(),
            variant
        );
    }
    assert!("saas".parse::<StartupType>().is_err());
}

#[test]
fn team_logo_url_must_be_an_absolute_http_url() {
    assert!(validate_team_logo_url("https://static.macro.com/file/abc").is_ok());
    assert!(validate_team_logo_url("http://localhost:8090/file/abc").is_ok());

    for bad in [
        "",
        "static.macro.com/file/abc",
        "ftp://static.macro.com/file/abc",
        "https://",
        "https:///file/abc",
        "https://static.macro.com/file/a b",
        "javascript:alert(1)",
    ] {
        assert!(
            matches!(validate_team_logo_url(bad), Err(TeamError::BadRequest(_))),
            "{bad:?} should be rejected"
        );
    }

    let too_long = format!(
        "https://static.macro.com/{}",
        "a".repeat(MAX_TEAM_LOGO_URL_LEN)
    );
    assert!(matches!(
        validate_team_logo_url(&too_long),
        Err(TeamError::BadRequest(_))
    ));
}

#[test]
fn team_profile_validate_only_checks_a_present_logo_url() {
    assert!(TeamProfile::default().validate().is_ok());
    assert!(
        TeamProfile {
            startup_type: Some(StartupType::Fintech),
            logo_url: None,
        }
        .validate()
        .is_ok()
    );
    assert!(
        TeamProfile {
            startup_type: None,
            logo_url: Some("not a url".to_string()),
        }
        .validate()
        .is_err()
    );
}

#[test]
fn new_team_has_no_profile_until_one_is_applied() {
    let team = team_with_enterprise_status(false);
    assert_eq!(team.startup_type(), None);
    assert_eq!(team.logo_url(), None);
    let serialized = serde_json::to_value(&team).unwrap();
    assert!(serialized["startup_type"].is_null());
    assert!(serialized["logo_url"].is_null());

    let team = team.with_profile(TeamProfile {
        startup_type: Some(StartupType::Ai),
        logo_url: Some("https://static.macro.com/file/logo".to_string()),
    });
    assert_eq!(team.startup_type(), Some(StartupType::Ai));
    assert_eq!(team.logo_url(), Some("https://static.macro.com/file/logo"));
    let serialized = serde_json::to_value(&team).unwrap();
    assert_eq!(serialized["startup_type"], "ai");
    assert_eq!(serialized["logo_url"], "https://static.macro.com/file/logo");
}

#[test]
fn patch_team_request_distinguishes_omitted_and_null_profile_fields() {
    let omitted: PatchTeamRequest = serde_json::from_str("{}").unwrap();
    assert_eq!(omitted.startup_type, None);
    assert_eq!(omitted.logo_url, None);

    let cleared: PatchTeamRequest =
        serde_json::from_str(r#"{"startup_type": null, "logo_url": null}"#).unwrap();
    assert_eq!(cleared.startup_type, Some(None));
    assert_eq!(cleared.logo_url, Some(None));

    let set: PatchTeamRequest = serde_json::from_str(
        r#"{"startup_type": "developer_tools", "logo_url": "https://static.macro.com/file/x"}"#,
    )
    .unwrap();
    assert_eq!(set.startup_type, Some(Some(StartupType::DeveloperTools)));
    assert_eq!(
        set.logo_url,
        Some(Some("https://static.macro.com/file/x".to_string()))
    );
}
