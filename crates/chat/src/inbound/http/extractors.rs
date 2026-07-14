//! Axum extractors for chat inbound handlers.

#[cfg(test)]
mod test;

use axum::{
    RequestPartsExt,
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};
use macro_authorization::{
    PermissionedMacroAuthorizationExtractor, PermissionedMacroAuthorizationRejection,
    SharedMacroAuthorizationService, SharedUserPermissionsService,
};
use roles_and_permissions::domain::model::PermissionId;

use crate::domain::models::FREE_MODEL;
use crate::domain::ports::ModelAccessService;
use crate::domain::service::ModelAccessServiceImpl;

/// Axum extractor resolving the requesting user's model entitlement from their
/// permissions.
///
/// Free users may use only [`FREE_MODEL`] (Haiku); professional (paid) users
/// may use every chat model. Backed by [`ModelAccessServiceImpl`].
#[derive(Debug, Clone, Copy)]
pub struct ChatModelAccess {
    professional: bool,
}

impl ChatModelAccess {
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
        if self.professional {
            "anthropic/claude-opus-4-8"
        } else {
            FREE_MODEL
        }
    }
}

impl<S> FromRequestParts<S> for ChatModelAccess
where
    SharedMacroAuthorizationService: FromRef<S>,
    SharedUserPermissionsService: FromRef<S>,
    S: Send + Sync + 'static,
{
    type Rejection = PermissionedMacroAuthorizationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let authorization: PermissionedMacroAuthorizationExtractor =
            parts.extract_with_state(state).await?;

        Ok(Self {
            professional: authorization
                .permissions
                .contains(&PermissionId::ReadProfessionalFeatures),
        })
    }
}
