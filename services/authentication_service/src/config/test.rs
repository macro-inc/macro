use super::*;

#[test]
fn complete_microsoft_credentials_are_resolved() {
    let credentials = resolve(
        Some("microsoft-client-id"),
        Some("microsoft-client-secret"),
        Some("microsoft-tenant-id"),
    )
    .expect("complete credentials should be valid");
    let Some(credentials) = credentials else {
        panic!("complete credentials should enable Microsoft OAuth");
    };

    assert_eq!(credentials.client_id, "microsoft-client-id");
    assert_eq!(credentials.client_secret, "microsoft-client-secret");
    assert_eq!(credentials.tenant_id, "microsoft-tenant-id");
    assert_eq!(credentials.token_kms_key_id, "microsoft-kms-key");
}

#[test]
fn absent_or_blank_microsoft_credentials_are_disabled() {
    let missing_values = [None, Some(""), Some(" \t ")];

    for client_id in missing_values {
        for client_secret in missing_values {
            for tenant_id in missing_values {
                let credentials = resolve(client_id, client_secret, tenant_id)
                    .expect("absent or blank credentials should be valid");
                assert!(credentials.is_none());
            }
        }
    }
}

#[test]
fn every_partial_microsoft_credential_combination_is_rejected() {
    for configured_fields in 1_u8..=6 {
        let client_id = (configured_fields & 0b001 != 0).then_some("microsoft-client-id");
        let client_secret = (configured_fields & 0b010 != 0).then_some("microsoft-client-secret");
        let tenant_id = (configured_fields & 0b100 != 0).then_some("microsoft-tenant-id");

        let error = resolve(client_id, client_secret, tenant_id)
            .err()
            .expect("partial credentials should be rejected");

        assert!(error.to_string().contains("must all be set"));
    }
}

#[test]
fn kms_key_is_required_when_microsoft_oauth_is_enabled() {
    for kms_key_id in [None, Some(""), Some(" \t ")] {
        let error = resolve_with_kms(
            Some("microsoft-client-id"),
            Some("microsoft-client-secret"),
            Some("microsoft-tenant-id"),
            kms_key_id,
        )
        .err()
        .expect("a KMS key is required with Microsoft credentials");

        assert!(error.to_string().contains("MICROSOFT_TOKEN_KMS_KEY_ID"));
    }
}

#[test]
fn kms_key_alone_does_not_enable_microsoft_oauth() {
    let credentials = resolve_with_kms(None, None, None, Some("microsoft-kms-key"))
        .expect("an unused KMS key should not enable Microsoft OAuth");

    assert!(credentials.is_none());
}

#[test]
fn blank_values_are_rejected_when_other_credentials_are_configured() {
    let partial_credentials = [
        (Some(" "), Some("client-secret"), Some("tenant-id")),
        (Some("client-id"), Some(" "), Some("tenant-id")),
        (Some("client-id"), Some("client-secret"), Some(" ")),
    ];

    for (client_id, client_secret, tenant_id) in partial_credentials {
        assert!(resolve(client_id, client_secret, tenant_id).is_err());
    }
}

fn resolve(
    client_id: Option<&'static str>,
    client_secret: Option<&'static str>,
    tenant_id: Option<&'static str>,
) -> anyhow::Result<Option<MicrosoftCredentials>> {
    resolve_with_kms(
        client_id,
        client_secret,
        tenant_id,
        Some("microsoft-kms-key"),
    )
}

fn resolve_with_kms(
    client_id: Option<&'static str>,
    client_secret: Option<&'static str>,
    tenant_id: Option<&'static str>,
    token_kms_key_id: Option<&'static str>,
) -> anyhow::Result<Option<MicrosoftCredentials>> {
    resolve_microsoft_credentials(
        &microsoft_client_id(client_id),
        &microsoft_client_secret(client_secret),
        &microsoft_tenant_id(tenant_id),
        &microsoft_token_kms_key_id(token_kms_key_id),
    )
}

fn microsoft_client_id(value: Option<&'static str>) -> MicrosoftClientId {
    match value {
        Some(value) => MicrosoftClientId::new_testing(value),
        None => MicrosoftClientId::new_unset(),
    }
}

fn microsoft_client_secret(value: Option<&'static str>) -> MicrosoftClientSecret {
    match value {
        Some(value) => MicrosoftClientSecret::new_testing(value),
        None => MicrosoftClientSecret::new_unset(),
    }
}

fn microsoft_tenant_id(value: Option<&'static str>) -> MicrosoftTenantId {
    match value {
        Some(value) => MicrosoftTenantId::new_testing(value),
        None => MicrosoftTenantId::new_unset(),
    }
}

fn microsoft_token_kms_key_id(value: Option<&'static str>) -> MicrosoftTokenKmsKeyId {
    match value {
        Some(value) => MicrosoftTokenKmsKeyId::new_testing(value),
        None => MicrosoftTokenKmsKeyId::new_unset(),
    }
}

fn development_allowlist(value: Option<&'static str>) -> DevelopmentSignupAllowlistJson {
    match value {
        Some(value) => DevelopmentSignupAllowlistJson::new_testing(value),
        None => DevelopmentSignupAllowlistJson::new_unset(),
    }
}

#[test]
fn develop_signup_policy_requires_configured_allowlist() {
    for value in [None, Some(""), Some(" \t ")] {
        let error = resolve_signup_policy(Environment::Develop, &development_allowlist(value))
            .expect_err("Develop should require a nonblank allowlist setting");

        assert!(
            error
                .to_string()
                .contains("DEVELOPMENT_SIGNUP_ALLOWLIST_JSON")
        );
    }
}

#[test]
fn develop_signup_policy_uses_configured_allowlist() {
    let policy = resolve_signup_policy(
        Environment::Develop,
        &development_allowlist(Some(
            r#"["Allowed.User@example.test", "allowed.user@example.test"]"#,
        )),
    )
    .expect("valid Develop allowlist should resolve");

    assert_eq!(policy.allowed_email_count(), Some(1));
    policy
        .authorize_public_email("allowed.user@example.test")
        .expect("configured email should be allowed");
}

#[test]
fn develop_signup_policy_rejects_malformed_allowlist_without_leaking_value() {
    let configured_value = "not-json-with-secret@example.test";
    let error = resolve_signup_policy(
        Environment::Develop,
        &development_allowlist(Some(configured_value)),
    )
    .expect_err("malformed Develop allowlist should be rejected");
    let message = error.to_string();

    assert!(message.contains("DEVELOPMENT_SIGNUP_ALLOWLIST_JSON"));
    assert!(!message.contains(configured_value));
    assert!(!format!("{error:?}").contains(configured_value));
}

#[test]
fn production_and_local_signup_policy_ignore_allowlist_setting() {
    for environment in [Environment::Production, Environment::Local] {
        let policy = resolve_signup_policy(
            environment,
            &development_allowlist(Some("not-json-with-secret@example.test")),
        )
        .expect("non-Develop environments should not parse the allowlist setting");

        assert_eq!(policy.allowed_email_count(), None);
        policy
            .authorize_public_email("anyone@example.test")
            .expect("non-Develop environments should allow all public signups");
    }
}

#[test]
fn cursor_kms_key_from_config_field() {
    let configured = CursorApiKeyKmsKeyId::new_testing("arn:aws:kms:from-config");
    assert_eq!(
        resolve_cursor_api_key_kms_key_id(&configured, None).unwrap(),
        "arn:aws:kms:from-config"
    );
}

#[test]
fn cursor_kms_key_from_process_env_when_config_unset() {
    let configured = CursorApiKeyKmsKeyId::new_unset();
    assert_eq!(
        resolve_cursor_api_key_kms_key_id(&configured, Some("arn:aws:kms:from-env")).unwrap(),
        "arn:aws:kms:from-env"
    );
}

#[test]
fn cursor_kms_key_prefers_config_over_process_env() {
    let configured = CursorApiKeyKmsKeyId::new_testing("arn:aws:kms:from-config");
    assert_eq!(
        resolve_cursor_api_key_kms_key_id(&configured, Some("arn:aws:kms:from-env")).unwrap(),
        "arn:aws:kms:from-config"
    );
}

#[test]
fn cursor_kms_key_blank_config_falls_back_to_process_env() {
    let configured = CursorApiKeyKmsKeyId::new_testing("  ");
    assert_eq!(
        resolve_cursor_api_key_kms_key_id(&configured, Some("arn:aws:kms:from-env")).unwrap(),
        "arn:aws:kms:from-env"
    );
}

#[test]
fn cursor_kms_key_required_when_both_absent() {
    let configured = CursorApiKeyKmsKeyId::new_unset();
    let error = resolve_cursor_api_key_kms_key_id(&configured, None).unwrap_err();
    assert!(error.to_string().contains("CURSOR_API_KEY_KMS_KEY_ID"));
}
