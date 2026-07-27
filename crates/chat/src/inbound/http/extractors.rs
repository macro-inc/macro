//! Axum extractors for chat inbound handlers.

use std::collections::HashSet;
use std::marker::PhantomData;
use std::sync::Arc;

use crate::domain::ports::ModelAccessService;
use crate::domain::service::ModelAccessServiceImpl;
use axum::extract::{FromRef, FromRequestParts};
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::IntoResponse;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationRejection, MacroAuthorizationService,
    MacroAuthorizationState, UserOrInternal,
};
use roles_and_permissions::domain::model::PermissionId;
use roles_and_permissions::domain::port::UserRolesAndPermissionsService;

/// Axum sub-state carrying the roles-and-permissions service used by
/// [`ChatModelAccess`].
///
/// A newtype (rather than a bare `Arc<P>` bound) so router states can expose
/// it via `FromRef` without colliding with other `Arc`-typed sub-states.
pub struct UserPermissionsState<P>(pub Arc<P>);

impl<P> Clone for UserPermissionsState<P> {
    fn clone(&self) -> Self {
        Self(Arc::clone(&self.0))
    }
}

/// Axum extractor resolving the requesting user's model entitlement from their
/// permissions.
///
/// Free users may use only [`FREE_MODEL`] (Haiku); professional (paid) users
/// may use every chat model. Backed by [`ModelAccessServiceImpl`].
///
/// Type parameter `Auth` is the authorization service implementation and `P`
/// is the roles-and-permissions service used to look up the caller's
/// permissions.
///
/// [`FREE_MODEL`]: crate::domain::models::FREE_MODEL
#[derive(Debug, Clone, Copy)]
pub struct ChatModelAccess<Auth, P> {
    professional: bool,
    _marker: PhantomData<fn() -> (Auth, P)>,
}

impl<Auth, P> ChatModelAccess<Auth, P> {
    /// Whether the user holds the professional (paid) entitlement.
    pub fn professional(&self) -> bool {
        self.professional
    }

    /// Whether the user may use the provider-qualified model identified by
    /// `model_id`.
    pub fn has_access(&self, model_id: &str) -> bool {
        ModelAccessServiceImpl.has_access(self.professional, model_id)
    }

    /// The default model for this user — the best one they're entitled to.
    pub fn best_model(&self) -> &'static str {
        ModelAccessServiceImpl.best_model(self.professional)
    }
}

/// Whether the user holds the professional (paid) entitlement, derived from the
/// existing roles-and-permissions access API.
fn is_professional(permissions: &HashSet<PermissionId>) -> bool {
    permissions.contains(&PermissionId::ReadProfessionalFeatures)
}

/// Error returned when [`ChatModelAccess`] cannot be extracted.
pub enum ChatModelAccessRejection {
    /// The caller's credentials were rejected by the authorization service.
    Unauthorized(MacroAuthorizationRejection),
    /// The caller's permissions could not be loaded.
    PermissionsLookup,
}

impl IntoResponse for ChatModelAccessRejection {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::Unauthorized(rejection) => rejection.into_response(),
            Self::PermissionsLookup => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to load user permissions",
            )
                .into_response(),
        }
    }
}

impl<S, Auth, P> FromRequestParts<S> for ChatModelAccess<Auth, P>
where
    MacroAuthorizationState<Auth>: FromRef<S>,
    Auth: MacroAuthorizationService,
    UserPermissionsState<P>: FromRef<S>,
    P: UserRolesAndPermissionsService,
    S: Send + Sync + 'static,
{
    type Rejection = ChatModelAccessRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let user =
            MacroAuthorizationExtractor::<Auth, UserOrInternal>::from_request_parts(parts, state)
                .await
                .map_err(ChatModelAccessRejection::Unauthorized)?;
        let user = &user.authorization.user;
        let UserPermissionsState(permissions_service) = UserPermissionsState::<P>::from_ref(state);
        let permissions = permissions_service
            .get_user_permissions(&user.macro_user_id)
            .await
            .map_err(|error| {
                tracing::error!(error=?error, user_id = %user.macro_user_id, "unable to load user permissions");
                ChatModelAccessRejection::PermissionsLookup
            })?;

        Ok(ChatModelAccess {
            professional: is_professional(&permissions),
            _marker: PhantomData,
        })
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::domain::models::FREE_MODEL;

    fn access(permissions: &[PermissionId]) -> ChatModelAccess<(), ()> {
        let professional = permissions.contains(&PermissionId::ReadProfessionalFeatures);
        ChatModelAccess {
            professional,
            _marker: PhantomData,
        }
    }

    fn permissions(permissions: &[PermissionId]) -> HashSet<PermissionId> {
        permissions.iter().cloned().collect()
    }

    #[test]
    fn no_permissions_is_free() {
        assert!(!is_professional(&HashSet::new()));
        assert!(!is_professional(&permissions(&[])));
    }

    #[test]
    fn professional_permission_is_professional() {
        assert!(is_professional(&permissions(&[
            PermissionId::ReadProfessionalFeatures
        ])));
    }

    #[test]
    fn free_user_defaults_to_haiku_and_only_has_haiku() {
        let free = access(&[]);
        assert_eq!(free.best_model(), FREE_MODEL);
        assert!(free.has_access(FREE_MODEL));
        assert!(!free.has_access("anthropic/claude-opus-5"));
    }

    #[test]
    fn professional_user_defaults_to_smart_and_has_everything() {
        let pro = access(&[PermissionId::ReadProfessionalFeatures]);
        assert_eq!(pro.best_model(), "anthropic/claude-sonnet-5");
        assert!(pro.has_access("anthropic/claude-sonnet-5"));
        assert!(pro.has_access("anthropic/claude-opus-5"));
        assert!(pro.has_access(FREE_MODEL));
        assert!(pro.has_access("openai/gpt-5.5"));
    }

    // Permission strings unrelated to the professional flag don't grant access.
    #[test]
    fn unrelated_permissions_stay_free() {
        let acc = access(&[PermissionId::WriteEmailTool, PermissionId::ReadDocxEditor]);
        assert!(!acc.professional());
        assert!(!acc.has_access("anthropic/claude-opus-5"));
    }
}
