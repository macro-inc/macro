//! Document permissions token validation used by mention endpoints.

use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use models_permissions::share_permission::access_level::AccessLevel;
use serde::Deserialize;

/// Claims encoded in the `x-permissions-token` JWT for a document.
#[derive(Debug, Deserialize)]
pub struct DocumentPermissionsTokenClaims {
    /// The document the token was issued for.
    pub document_id: String,
    /// The access level granted to the bearer.
    pub access_level: AccessLevel,
}

/// Errors that can occur while validating a permissions token.
#[derive(Debug, thiserror::Error)]
pub enum PermissionsTokenError {
    /// Token failed to decode (e.g. invalid signature, malformed payload).
    #[error("invalid permissions token")]
    InvalidToken,
    /// Token document_id does not match the requested document.
    #[error("token document id does not match")]
    DocumentMismatch,
    /// Token grants insufficient access for the requested operation.
    #[error("insufficient permissions: edit access required")]
    InsufficientPermissions,
}

/// Decode and validate the JWT, then verify it grants edit access to `document_id`.
pub fn validate_edit_document_permission(
    token: &str,
    document_id: &str,
    secret_key: &str,
) -> Result<(), PermissionsTokenError> {
    let validation = Validation::new(Algorithm::HS256);
    let key = DecodingKey::from_secret(secret_key.as_bytes());
    let claims = decode::<DocumentPermissionsTokenClaims>(token, &key, &validation)
        .map_err(|_| PermissionsTokenError::InvalidToken)?
        .claims;

    if claims.document_id != document_id {
        return Err(PermissionsTokenError::DocumentMismatch);
    }

    match claims.access_level {
        AccessLevel::Edit | AccessLevel::Owner => Ok(()),
        _ => Err(PermissionsTokenError::InsufficientPermissions),
    }
}
