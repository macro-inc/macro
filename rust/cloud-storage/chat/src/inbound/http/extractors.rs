//! Axum extractors for chat inbound handlers.

use agent::AgentModel;
use axum::extract::FromRequestParts;
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::IntoResponse;
use model::user::UserContext;
use roles_and_permissions::domain::model::PermissionId;
use std::collections::HashSet;

/// Axum extractor that resolves the AI model a user is entitled to based on
/// their permissions.
///
/// Paid users get their highest subscribed model. Free users get Haiku.
#[derive(Debug)]
pub struct ChatModelAccess(AgentModel);

impl ChatModelAccess {
    /// Returns the resolved model.
    pub fn model(&self) -> AgentModel {
        self.0
    }
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

fn model_for_permissions(permissions: Option<&HashSet<String>>) -> AgentModel {
    let Some(permissions) = permissions else {
        return AgentModel::Haiku4_5;
    };

    if permissions.contains(&PermissionId::WriteOpus.to_string()) {
        AgentModel::Opus4_7
    } else if permissions.contains(&PermissionId::WriteSonnet.to_string()) {
        AgentModel::Sonnet4_6
    } else {
        AgentModel::Haiku4_5
    }
}

impl<S: Send + Sync> FromRequestParts<S> for ChatModelAccess {
    type Rejection = ChatModelAccessRejection;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let user_context = parts
            .extensions
            .get::<UserContext>()
            .ok_or(ChatModelAccessRejection::MissingUserContext)?;

        Ok(ChatModelAccess(model_for_permissions(
            user_context.permissions.as_ref(),
        )))
    }
}

#[cfg(test)]
mod test {
    use super::*;

    fn permissions(values: &[PermissionId]) -> HashSet<String> {
        values.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn missing_permissions_resolve_to_haiku() {
        assert_eq!(model_for_permissions(None), AgentModel::Haiku4_5);
    }

    #[test]
    fn empty_permissions_resolve_to_haiku() {
        let permissions = HashSet::new();

        assert_eq!(
            model_for_permissions(Some(&permissions)),
            AgentModel::Haiku4_5
        );
    }

    #[test]
    fn haiku_permission_resolves_to_haiku() {
        let permissions = permissions(&[PermissionId::WriteHaiku]);

        assert_eq!(
            model_for_permissions(Some(&permissions)),
            AgentModel::Haiku4_5
        );
    }

    #[test]
    fn sonnet_permission_resolves_to_sonnet() {
        let permissions = permissions(&[PermissionId::WriteHaiku, PermissionId::WriteSonnet]);

        assert_eq!(
            model_for_permissions(Some(&permissions)),
            AgentModel::Sonnet4_6
        );
    }

    #[test]
    fn opus_permission_resolves_to_opus() {
        let permissions = permissions(&[
            PermissionId::WriteHaiku,
            PermissionId::WriteSonnet,
            PermissionId::WriteOpus,
        ]);

        assert_eq!(
            model_for_permissions(Some(&permissions)),
            AgentModel::Opus4_7
        );
    }
}
