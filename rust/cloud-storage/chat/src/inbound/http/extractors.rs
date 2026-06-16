//! Axum extractors for chat inbound handlers.

use crate::domain::models::FREE_MODEL;
use crate::domain::ports::ModelAccessService;
use crate::domain::service::ModelAccessServiceImpl;
use agent::AgentModel;
use axum::extract::FromRequestParts;
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::IntoResponse;
use model::user::UserContext;
use roles_and_permissions::domain::model::PermissionId;

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

    /// Whether the user may use the model identified by `model_id` (an api id).
    pub fn has_access(&self, model_id: &str) -> bool {
        ModelAccessServiceImpl.has_access(self.professional, model_id)
    }

    /// The default model for this user — the best one they're entitled to.
    pub fn model(&self) -> AgentModel {
        if self.professional {
            AgentModel::Smart
        } else {
            FREE_MODEL
        }
    }
}

/// Whether the user holds the professional (paid) entitlement, derived from the
/// existing roles-and-permissions access API.
fn is_professional(user: &UserContext) -> bool {
    user.permissions
        .as_ref()
        .is_some_and(|perms| perms.contains(&PermissionId::ReadProfessionalFeatures.to_string()))
}

/// Error returned when [`ChatModelAccess`] cannot be extracted.
pub enum ChatModelAccessRejection {
    /// The `UserContext` extension was missing (middleware not applied).
    MissingUserContext,
}

impl IntoResponse for ChatModelAccessRejection {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::MissingUserContext => {
                (StatusCode::INTERNAL_SERVER_ERROR, "missing user context").into_response()
            }
        }
    }
}

impl<S: Send + Sync> FromRequestParts<S> for ChatModelAccess {
    type Rejection = ChatModelAccessRejection;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let user_context = parts
            .extensions
            .get::<UserContext>()
            .ok_or(ChatModelAccessRejection::MissingUserContext)?;

        Ok(ChatModelAccess {
            professional: is_professional(user_context),
        })
    }
}

#[cfg(test)]
mod test {
    use super::*;

    fn access(permissions: &[PermissionId]) -> ChatModelAccess {
        let professional = permissions.contains(&PermissionId::ReadProfessionalFeatures);
        ChatModelAccess { professional }
    }

    fn user(permissions: &[PermissionId]) -> UserContext {
        UserContext {
            permissions: Some(permissions.iter().map(ToString::to_string).collect()),
            ..Default::default()
        }
    }

    #[test]
    fn no_permissions_is_free() {
        assert!(!is_professional(&UserContext::default()));
        assert!(!is_professional(&user(&[])));
    }

    #[test]
    fn professional_permission_is_professional() {
        assert!(is_professional(&user(&[
            PermissionId::ReadProfessionalFeatures
        ])));
    }

    #[test]
    fn free_user_defaults_to_haiku_and_only_has_haiku() {
        let free = access(&[]);
        assert_eq!(free.model(), FREE_MODEL);
        assert!(free.has_access(FREE_MODEL.api_id()));
        assert!(!free.has_access(AgentModel::Smart.api_id()));
    }

    #[test]
    fn professional_user_defaults_to_smart_and_has_everything() {
        let pro = access(&[PermissionId::ReadProfessionalFeatures]);
        assert_eq!(pro.model(), AgentModel::Smart);
        assert!(pro.has_access(AgentModel::Smart.api_id()));
        assert!(pro.has_access(FREE_MODEL.api_id()));
    }

    // Permission strings unrelated to the professional flag don't grant access.
    #[test]
    fn unrelated_permissions_stay_free() {
        let acc = access(&[PermissionId::WriteHaiku, PermissionId::WriteOpus]);
        assert!(!acc.professional());
        assert!(!acc.has_access(AgentModel::Smart.api_id()));
    }
}
