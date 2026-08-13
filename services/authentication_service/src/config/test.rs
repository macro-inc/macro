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
    resolve_microsoft_credentials(
        &microsoft_client_id(client_id),
        &microsoft_client_secret(client_secret),
        &microsoft_tenant_id(tenant_id),
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
