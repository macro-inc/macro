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

use crate::api::context::ApiContext;

pub(in crate::api) mod delete_cursor_api_key;
pub(in crate::api) mod get_cursor_api_key;
pub(in crate::api) mod put_cursor_api_key;

/// Routes for the settings surface's Cursor connection.
pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(get_cursor_api_key::handler))
        .route("/", put(put_cursor_api_key::handler))
        .route("/", delete(delete_cursor_api_key::handler))
}

/// What settings needs to render the Cursor connection.
///
/// Deliberately thin. `registered` drives the whole UI; `updatedAt` lets it say
/// when the key was last replaced, which is the only thing a user can check
/// against their own memory when a session starts failing.
#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CursorApiKeyStatus {
    /// Whether this user has a key stored.
    pub registered: bool,
    /// Whether this deployment accepts Cursor keys at all — false when no KMS
    /// key is configured, so the UI can explain rather than fail on save.
    pub available: bool,
    /// When the stored key was last replaced, if there is one.
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Everything the three handlers can fail with.
#[derive(Debug, thiserror::Error)]
pub enum CursorApiKeyError {
    /// The supplied value does not look like a Cursor API key.
    #[error("value does not look like a Cursor API key")]
    MalformedKey,
    /// This deployment has no KMS key configured for Cursor keys.
    #[error("this deployment does not accept Cursor API keys")]
    Unavailable,
    /// The caller's user id could not be read.
    #[error("unable to parse user id")]
    InvalidMacroUserId,
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
            // Not "forbidden": the caller is allowed, the deployment cannot.
            Self::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            Self::InvalidMacroUserId => StatusCode::BAD_REQUEST,
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
