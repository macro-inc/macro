//! Registering the Cursor API key that a user's `@cursor` sessions run on.
//!
//! Three operations and no OAuth: unlike `/link/outlook`, a Cursor key is
//! something the user pastes, so there is no redirect to broker and no callback
//! to land. The key is checked for shape, encrypted, and stored.
//!
//! **The key is never readable again through this API.** `GET` answers whether
//! one is registered and nothing more — no prefix, no length, no masked form.
//! A masked key is still a leak of length and alphabet, and there is no screen
//! that needs it: a user who has lost their key rotates it at Cursor and pastes
//! a new one.

use axum::{
    Router,
    routing::{delete, get, put},
};
use macro_user_id::{email::ReadEmailParts, user_id::MacroUserIdStr};

use crate::api::context::ApiContext;

#[cfg(test)]
mod test;

pub(in crate::api) mod delete_cursor_api_key;
pub(in crate::api) mod get_cursor_api_key;
pub(in crate::api) mod list_cursor_models;
pub(in crate::api) mod put_cursor_api_key;
pub(in crate::api) mod put_cursor_default_model;

/// Routes for the settings surface's Cursor connection.
pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(get_cursor_api_key::handler))
        .route("/", put(put_cursor_api_key::handler))
        .route("/", delete(delete_cursor_api_key::handler))
        // The models this account may pick from, for the settings dropdown.
        .route("/models", get(list_cursor_models::handler))
        // The model new sessions start on.
        .route("/default-model", put(put_cursor_default_model::handler))
}

fn require_macro_staff(user_id: &MacroUserIdStr<'_>) -> Result<(), CursorApiKeyError> {
    if user_id.email_part().domain_part() != "macro.com" {
        return Err(CursorApiKeyError::NotMacroStaff);
    }
    Ok(())
}

/// What settings needs to render the Cursor connection.
///
/// Deliberately thin. `registered` drives the whole UI; `updatedAt` lets it say
/// when the key was last replaced, which is the only thing a user can check
/// against their own memory when a session starts failing.
///
/// Deliberately *not* reporting anything about the deployment itself. That is
/// operator information: a user who sees it cannot act on it, and a service
/// that cannot reach KMS does not start.
#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CursorApiKeyStatus {
    /// Whether this user has a key stored.
    pub registered: bool,
    /// The Cursor model id this user's sessions start on, when they have
    /// chosen one. `None` means the deployment default is in effect — the
    /// settings dropdown shows that as its resting value.
    pub default_model_id: Option<String>,
    /// When the stored key was last replaced, if there is one.
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Everything the three handlers can fail with.
#[derive(Debug, thiserror::Error)]
pub enum CursorApiKeyError {
    /// The supplied value does not look like a Cursor API key.
    #[error("value does not look like a Cursor API key")]
    MalformedKey,
    /// Cursor agents are currently restricted to Macro staff.
    #[error("Cursor agents are only available to Macro staff")]
    NotMacroStaff,
    /// An operation that needs a connected account was attempted without one —
    /// e.g. choosing a model before pasting a key.
    #[error("connect a Cursor API key first")]
    NotConnected,
    /// Cursor's own API could not be reached or refused the request — listing
    /// models, say. Distinct from [`Self::Internal`] so the client can tell
    /// "Cursor is having a moment" from "we broke".
    #[error("Cursor's API is unavailable right now")]
    CursorUnavailable,
    /// Encryption or persistence failed.
    #[error("internal error")]
    Internal,
}

impl axum::response::IntoResponse for CursorApiKeyError {
    fn into_response(self) -> axum::response::Response {
        use axum::http::StatusCode;
        let status = match self {
            // A shape this service cannot use is the client's mistake.
            Self::MalformedKey => StatusCode::BAD_REQUEST,
            Self::NotMacroStaff => StatusCode::FORBIDDEN,
            Self::NotConnected => StatusCode::CONFLICT,
            Self::CursorUnavailable => StatusCode::BAD_GATEWAY,
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        // `to_string` and nothing else: every variant's message is written to
        // be safe to return, and none of them names the value that failed.
        (
            status,
            axum::Json(model::response::ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}
