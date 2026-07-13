use std::collections::HashSet;

use rootcause::Report;

use super::*;
use crate::domain::{
    models::{MacroAuthorizationError, ValidatedIdentity},
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

#[tokio::test]
async fn authorize_constructs_user_context_from_validated_identity() {
    let permissions = HashSet::from(["documents:read".to_string(), "documents:write".to_string()]);
    let service = MacroAuthorizationServiceImpl::new(FakeJwtValidator {
        result: Ok(ValidatedIdentity {
            user_id: "macro|user@example.com".to_string(),
            fusion_user_id: "fusion-user-id".to_string(),
            organization_id: Some(42),
            permissions: Some(permissions.clone()),
        }),
    });

    let context = service.authorize("valid-jwt").await.unwrap();

    assert_eq!(context.user_id, "macro|user@example.com");
    assert_eq!(context.fusion_user_id, "fusion-user-id");
    assert_eq!(context.organization_id, Some(42));
    assert_eq!(context.permissions, Some(permissions));
}

#[tokio::test]
async fn authorize_propagates_expired_credentials() {
    let service = MacroAuthorizationServiceImpl::new(FakeJwtValidator {
        result: Err(MacroAuthorizationError::CredentialsExpired),
    });

    let error = service.authorize("expired-jwt").await.unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::CredentialsExpired
    );
}

#[tokio::test]
async fn authorize_propagates_invalid_credentials() {
    let service = MacroAuthorizationServiceImpl::new(FakeJwtValidator {
        result: Err(MacroAuthorizationError::InvalidCredentials),
    });

    let error = service.authorize("invalid-jwt").await.unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::InvalidCredentials
    );
}
