use std::time::{SystemTime, UNIX_EPOCH};

use ::macro_auth::{
    error::MacroAuthError,
    macro_api_token::MacroApiToken,
    middleware::decode_jwt::{JwtToken, JwtValidationArgs, MacroAccessToken},
};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use rootcause::Report;

use super::*;

const MACRO_USER_ID: &str = "macro|user@example.com";
const FUSION_USER_ID: &str = "fusion-user-id";

fn unix_timestamp() -> usize {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after the Unix epoch")
        .as_secs() as usize
}

fn access_token(
    secret: &str,
    expiration: usize,
    root_macro_id: Option<&str>,
    organization_id: Option<i32>,
) -> String {
    let claims = MacroAccessToken {
        aud: String::new(),
        exp: expiration,
        tid: "tenant-id".to_string(),
        iss: String::new(),
        email: "user@example.com".to_string(),
        fusion_user_id: FUSION_USER_ID.to_string(),
        macro_user_id: MACRO_USER_ID.to_string(),
        macro_organization_id: organization_id,
        root_macro_id: root_macro_id.map(str::to_string),
    };
    let mut header = Header::new(Algorithm::HS256);
    header.kid = Some("fusionauth".to_string());

    encode(
        &header,
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .expect("test JWT should encode")
}

fn validator() -> MacroAuthJwtValidator {
    MacroAuthJwtValidator::new(JwtValidationArgs::new_testing())
}

fn macro_auth_cause(report: &Report<MacroAuthorizationError>) -> &MacroAuthError {
    report
        .iter_sub_reports()
        .find_map(|cause| cause.downcast_current_context::<MacroAuthError>())
        .expect("validation report should retain its macro_auth cause")
}

#[test]
fn validates_access_token() {
    let token = access_token("", unix_timestamp() + 3_600, None, None);

    let identity = validator().validate(&token).unwrap();

    assert_eq!(identity.user_id, MACRO_USER_ID);
    assert_eq!(identity.fusion_user_id, FUSION_USER_ID);
    assert_eq!(identity.organization_id, None);
    assert_eq!(identity.permissions, None);
}

#[test]
fn maps_expired_access_token_to_typed_error() {
    let token = access_token("", unix_timestamp() - 3_600, None, None);

    let error = validator().validate(&token).unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::CredentialsExpired
    );
    assert!(matches!(
        macro_auth_cause(&error),
        MacroAuthError::JwtExpired
    ));
}

#[test]
fn maps_malformed_token_to_invalid_credentials() {
    let error = validator().validate("not-a-jwt").unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::InvalidCredentials
    );
    assert!(matches!(
        macro_auth_cause(&error),
        MacroAuthError::Generic(_)
    ));
}

#[test]
fn maps_wrong_signature_to_invalid_credentials() {
    let token = access_token("wrong-secret", unix_timestamp() + 3_600, None, None);

    let error = validator().validate(&token).unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::InvalidCredentials
    );
    assert!(matches!(
        macro_auth_cause(&error),
        MacroAuthError::JwtValidationFailed { .. }
    ));
}

#[test]
fn maps_root_macro_id_to_fusion_identity_field() {
    let token = access_token("", unix_timestamp() + 3_600, Some("root-macro-id"), None);

    let identity = validator().validate(&token).unwrap();

    assert_eq!(identity.user_id, MACRO_USER_ID);
    assert_eq!(identity.fusion_user_id, "root-macro-id");
}

#[test]
fn preserves_access_token_organization_id() {
    let token = access_token("", unix_timestamp() + 3_600, None, Some(42));

    let identity = validator().validate(&token).unwrap();

    assert_eq!(identity.organization_id, Some(42));
}

#[test]
fn maps_macro_api_token_claims() {
    let identity = identity_from_token(JwtToken::MacroApiToken(MacroApiToken {
        exp: unix_timestamp() + 3_600,
        iss: String::new(),
        fusion_user_id: FUSION_USER_ID.to_string(),
        macro_user_id: MACRO_USER_ID.to_string(),
        macro_organization_id: Some(84),
    }));

    assert_eq!(identity.user_id, MACRO_USER_ID);
    assert_eq!(identity.fusion_user_id, FUSION_USER_ID);
    assert_eq!(identity.organization_id, Some(84));
    assert_eq!(identity.permissions, None);
}
