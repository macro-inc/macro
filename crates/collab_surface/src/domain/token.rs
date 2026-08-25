//! Minting sync-service connection tokens for collab surfaces.
//!
//! A surface token is the same JWT shape the sync service already validates
//! for documents ([`model::document::DocumentPermissionsToken`], signed with
//! the shared `document_permission_jwt` secret): the worker string-compares
//! the `document_id` claim against its session key, so a surface id flows
//! through the existing claim unchanged. Deliberately not lifted into
//! `macro_sync_service_jwt` — that crate stays dependency-minimal because it
//! also compiles to wasm for the sync-service worker.

use std::time::{SystemTime, UNIX_EPOCH};

use entity_access::domain::models::EntityPermission;
use macro_sync_service_jwt::{DocumentPermissionToken, ISSUER, TOKEN_TTL_SECS};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::DocumentPermissionsToken;
use models_permissions::share_permission::access_level::AccessLevel;

use crate::domain::models::CollabSurfaceError;

/// The sync-service access level implied by a parent-entity permission.
///
/// Channel members collaborate as editors; a view-only channel presence gets a
/// read-only session. Team roles have no surface semantics yet and fail
/// closed.
pub fn access_level_for(permission: &EntityPermission) -> Result<AccessLevel, CollabSurfaceError> {
    match permission {
        EntityPermission::AccessLevel { access_level } => Ok(*access_level),
        EntityPermission::ChannelRole { .. } => Ok(AccessLevel::Edit),
        EntityPermission::ChannelViewOnly => Ok(AccessLevel::View),
        EntityPermission::TeamRole { .. } => Err(CollabSurfaceError::AccessDenied),
    }
}

/// Sign a sync-service connection token for `surface_id`.
pub fn encode_surface_token(
    user_id: MacroUserIdStr<'static>,
    surface_id: String,
    access_level: AccessLevel,
    jwt_secret: &str,
) -> Result<DocumentPermissionToken, CollabSurfaceError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_secs() as usize;

    macro_sync_service_jwt::encode(
        &DocumentPermissionsToken {
            user_id: Some(user_id),
            document_id: surface_id,
            access_level,
            exp: now + TOKEN_TTL_SECS,
            iss: ISSUER.to_string(),
        },
        jwt_secret,
    )
    .map_err(|e| CollabSurfaceError::Internal(rootcause::Report::new(e).into_dynamic()))
}
