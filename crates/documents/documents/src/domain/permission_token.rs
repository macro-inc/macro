//! Helpers for issuing document permission tokens (signed JWTs) used by the
//! sync service to authorize document access.

#[cfg(test)]
mod test;

use crate::domain::models::DocumentError;
use entity_access::domain::models::{EntityAccessAuth, EntityAccessReceipt, RequiredPermission};
use macro_sync_service_jwt::{DocumentPermissionToken, ISSUER, TOKEN_TTL_SECS};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::CreationPrincipal;
use permissions_types::share_permission::access_level::AccessLevel;
use std::time::{SystemTime, UNIX_EPOCH};

/// Claims minted for the sync service. `actor` is not on the public
/// document-permissions token type so the OpenAPI validate API stays unchanged.
#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct PermissionTokenClaims {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) agent_correlation_id: Option<uuid::Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) user_id: Option<MacroUserIdStr<'static>>,
    document_id: String,
    pub(crate) access_level: AccessLevel,
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
            agent_correlation_id: agent_correlation::context::current(),
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

/// Sign a document permission token for the holder of an access receipt: its
/// acting user, with its bot, if any, as the actor.
pub fn encode_receipt_permission_token<Permission: RequiredPermission>(
    access: &EntityAccessReceipt<Permission>,
    access_level: AccessLevel,
    jwt_secret: &str,
) -> Result<DocumentPermissionToken, DocumentError> {
    let bot = match access.auth() {
        EntityAccessAuth::Bot(bot) => Some(bot.bot_id()),
        EntityAccessAuth::Authenticated(_)
        | EntityAccessAuth::Unauthenticated
        | EntityAccessAuth::Internal => None,
    };
    let user = access.acting_user_id();
    if user.is_none() && bot.is_none() {
        return Err(DocumentError::Unauthorized);
    }

    encode_permission_token(
        user.map(ToString::to_string),
        access.entity().entity_id.clone(),
        access_level,
        jwt_secret,
        bot.map(|bot| bot.into_storage_id().to_string()),
    )
}

/// Sign a document permission token for `principal`.
///
/// A bot principal is the token's actor. A team bot acts for no user, so its
/// token carries no user id.
pub fn encode_principal_permission_token(
    principal: &CreationPrincipal,
    document_id: String,
    access_level: AccessLevel,
    jwt_secret: &str,
) -> Result<DocumentPermissionToken, DocumentError> {
    encode_permission_token(
        principal.user().map(|user| user.as_ref().to_string()),
        document_id,
        access_level,
        jwt_secret,
        principal.bot().map(|bot| bot.into_storage_id().to_string()),
    )
}

/// Read claims from a token minted by [`encode_permission_token`].
#[cfg(test)]
pub(crate) fn decode_permission_token(
    token: &DocumentPermissionToken,
    jwt_secret: &str,
) -> Result<PermissionTokenClaims, DocumentError> {
    Ok(macro_sync_service_jwt::decode(token.as_str(), jwt_secret)?)
}
