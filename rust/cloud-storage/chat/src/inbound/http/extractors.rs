//! Axum extractors for chat inbound handlers.

use agent::AgentModel;
use axum::extract::FromRequestParts;
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::IntoResponse;
use model::user::UserContext;
use roles_and_permissions::domain::model::PermissionId;

/// Axum extractor that resolves the best AI model a user has access to based
/// on their permissions.
///
/// The permission hierarchy is: Opus > Sonnet > Haiku.  If the user has none
/// of these permissions the extractor rejects with `402 Payment Required`.
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
    /// The `UserContext` had no permissions attached.
    MissingPermissions,
    /// The user has no AI model permissions (free tier).
    NoModelAccess,
}

impl IntoResponse for ChatModelAccessRejection {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::MissingUserContext => {
                (StatusCode::INTERNAL_SERVER_ERROR, "missing user context").into_response()
            }
            Self::MissingPermissions => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "missing user permissions",
            )
                .into_response(),
            Self::NoModelAccess => (
                StatusCode::PAYMENT_REQUIRED,
                "AI features require a paid subscription",
            )
                .into_response(),
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

        let permissions = user_context
            .permissions
            .as_ref()
            .ok_or(ChatModelAccessRejection::MissingPermissions)?;

        let model = if permissions.contains(&PermissionId::WriteOpus.to_string()) {
            AgentModel::Opus4_7
        } else if permissions.contains(&PermissionId::WriteSonnet.to_string()) {
            AgentModel::Sonnet4_6
        } else if permissions.contains(&PermissionId::WriteHaiku.to_string()) {
            AgentModel::Haiku4_5
        } else {
            return Err(ChatModelAccessRejection::NoModelAccess);
        };

        Ok(ChatModelAccess(model))
    }
}
