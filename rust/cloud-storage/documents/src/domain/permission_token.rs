//! Helpers for issuing document permission tokens (signed JWTs) used by the
//! sync service to authorize document access.

use model::document::DocumentPermissionsToken;
use models_permissions::share_permission::access_level::AccessLevel;
use std::time::{SystemTime, UNIX_EPOCH};

/// Token lifetime in seconds (1 hour).
const TOKEN_TTL_SECS: usize = 3600;

/// Sign a document permission token for the given user and document.
pub fn encode_permission_token(
    user_id: Option<String>,
    document_id: String,
    access_level: AccessLevel,
    jwt_secret: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize;

    jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256),
        &DocumentPermissionsToken {
            user_id,
            document_id,
            access_level,
            exp: now + TOKEN_TTL_SECS,
            iss: "document_storage_service".to_string(),
        },
        &jsonwebtoken::EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
}
