//! Helpers for issuing document permission tokens (signed JWTs) used by the
//! sync service to authorize document access.

use crate::domain::models::DocumentError;
use macro_sync_service_jwt::{DocumentPermissionToken, ISSUER, TOKEN_TTL_SECS};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::DocumentPermissionsToken;
use models_permissions::share_permission::access_level::AccessLevel;
use std::time::{SystemTime, UNIX_EPOCH};

/// Sign a document permission token for the given user and document.
pub fn encode_permission_token(
    user_id: Option<String>,
    document_id: String,
    access_level: AccessLevel,
    jwt_secret: &str,
) -> Result<DocumentPermissionToken, DocumentError> {
    let user_id = user_id
        .map(MacroUserIdStr::try_from)
        .transpose()
        .map_err(|e| DocumentError::Internal(anyhow::anyhow!("invalid user id: {e}")))?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize;

    Ok(macro_sync_service_jwt::encode(
        &DocumentPermissionsToken {
            user_id,
            document_id,
            access_level,
            exp: now + TOKEN_TTL_SECS,
            iss: ISSUER.to_string(),
        },
        jwt_secret,
    )?)
}
