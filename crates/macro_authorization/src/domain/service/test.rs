use std::collections::HashSet;

use rootcause::Report;

use super::*;
use crate::domain::{
    models::{
        InternalAuthConfig, InternalIdentityClaims, MacroAuthorizationError, ValidatedIdentity,
    },
    ports::JwtValidator,
};

#[derive(Clone)]
struct FakeJwtValidator {
    result: Result<ValidatedIdentity, MacroAuthorizationError>,
}

impl JwtValidator for FakeJwtValidator {
    fn validate(&self, _jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        self.result.clone().map_err(Report::new)
    }
}

const INTERNAL_API_KEY: &str = "secret-key";

fn internal_auth_config(default_user_id: Option<&str>) -> InternalAuthConfig {
    InternalAuthConfig {
        api_key: INTERNAL_API_KEY.to_string(),
        default_user_id: default_user_id.map(str::to_string),
    }
}

fn service_with_internal_auth(
    default_user_id: Option<&str>,
) -> MacroAuthorizationServiceImpl<FakeJwtValidator> {
    MacroAuthorizationServiceImpl::new(
        FakeJwtValidator {
            result: Err(MacroAuthorizationError::InvalidCredentials),
        },
        internal_auth_config(default_user_id),
    )
}

#[tokio::test]
async fn authorize_constructs_user_context_from_validated_identity() {
    let permissions = HashSet::from(["documents:read".to_string(), "documents:write".to_string()]);
    let service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator {
            result: Ok(ValidatedIdentity {
                user_id: "macro|user@example.com".to_string(),
                fusion_user_id: "fusion-user-id".to_string(),
                organization_id: Some(42),
                permissions: Some(permissions.clone()),
            }),
        },
        internal_auth_config(None),
    );

    let context = service.authorize("valid-jwt").await.unwrap();

    assert_eq!(context.user_id, "macro|user@example.com");
    assert_eq!(context.fusion_user_id, "fusion-user-id");
    assert_eq!(context.organization_id, Some(42));
    assert_eq!(context.permissions, Some(permissions));
}

#[tokio::test]
async fn authorize_internal_rejects_an_incorrect_key() {
    let service = service_with_internal_auth(None);

    let error = service
        .authorize_internal("secret-kex", InternalIdentityClaims::default())
        .await
        .unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::InvalidCredentials
    );
}

#[tokio::test]
async fn authorize_internal_maps_explicit_identity_claims() {
    let service = service_with_internal_auth(Some("macro|default@example.com"));

    let context = service
        .authorize_internal(
            INTERNAL_API_KEY,
            InternalIdentityClaims {
                user_id: Some("macro|acting@example.com".to_string()),
                fusion_user_id: Some("fusion-user-id".to_string()),
                organization_id: Some(42),
            },
        )
        .await
        .unwrap()
        .expect("explicit user claim should establish an identity");

    assert_eq!(context.user_id, "macro|acting@example.com");
    assert_eq!(context.fusion_user_id, "fusion-user-id");
    assert_eq!(context.organization_id, Some(42));
    assert_eq!(context.permissions, None);
}

#[tokio::test]
async fn authorize_internal_uses_the_configured_default_user() {
    let service = service_with_internal_auth(Some("macro|default@example.com"));

    let context = service
        .authorize_internal(INTERNAL_API_KEY, InternalIdentityClaims::default())
        .await
        .unwrap()
        .expect("configured default user should establish an identity");

    assert_eq!(context.user_id, "macro|default@example.com");
    assert_eq!(context.fusion_user_id, "");
    assert_eq!(context.organization_id, None);
    assert_eq!(context.permissions, None);
}

#[tokio::test]
async fn authorize_internal_returns_none_without_an_identity() {
    let service = service_with_internal_auth(None);

    let context = service
        .authorize_internal(INTERNAL_API_KEY, InternalIdentityClaims::default())
        .await
        .unwrap();

    assert!(context.is_none());
}

#[tokio::test]
async fn authorize_propagates_expired_credentials() {
    let service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator {
            result: Err(MacroAuthorizationError::CredentialsExpired),
        },
        internal_auth_config(None),
    );

    let error = service.authorize("expired-jwt").await.unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::CredentialsExpired
    );
}

#[tokio::test]
async fn authorize_propagates_invalid_credentials() {
    let service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator {
            result: Err(MacroAuthorizationError::InvalidCredentials),
        },
        internal_auth_config(None),
    );

    let error = service.authorize("invalid-jwt").await.unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::InvalidCredentials
    );
}
