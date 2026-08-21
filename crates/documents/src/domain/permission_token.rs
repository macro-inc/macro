//! Helpers for issuing document permission tokens (signed JWTs) used by the
//! sync service to authorize document access.

use crate::domain::models::DocumentError;
use macro_sync_service_jwt::{DocumentPermissionToken, ISSUER, TOKEN_TTL_SECS};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use std::time::{SystemTime, UNIX_EPOCH};

/// Claims minted for the sync service. `actor` is not on the public
/// document-permissions token type so the OpenAPI validate API stays unchanged.
#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct PermissionTokenClaims {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) user_id: Option<MacroUserIdStr<'static>>,
    document_id: String,
    access_level: AccessLevel,
    exp: usize,
    iss: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) actor: Option<String>,
}

/// Sign a document permission token for the given user and document.
pub fn encode_permission_token(
    user_id: Option<String>,
    document_id: String,
    access_level: AccessLevel,
    jwt_secret: &str,
    actor: Option<String>,
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
        &PermissionTokenClaims {
            user_id,
            document_id,
            access_level,
            exp: now + TOKEN_TTL_SECS,
            iss: ISSUER.to_string(),
            actor,
        },
        jwt_secret,
    )?)
}

/// Read claims from a token minted by [`encode_permission_token`].
#[cfg(test)]
pub(crate) fn decode_permission_token(
    token: &DocumentPermissionToken,
    jwt_secret: &str,
) -> Result<PermissionTokenClaims, DocumentError> {
    Ok(macro_sync_service_jwt::decode(token.as_str(), jwt_secret)?)
}
