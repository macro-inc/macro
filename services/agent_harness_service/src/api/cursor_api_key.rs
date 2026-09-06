//! Registering the Cursor API key that a user's Cursor agent runs on.
//!
//! Three operations and no OAuth: a Cursor key is something the user pastes,
//! so there is no redirect to broker and no callback to land. The key is
//! checked for shape, encrypted, and stored. Registering it also gives the
//! user their private `@cursor` agent (see [`put_cursor_api_key`]).
//!
//! **The key is never readable again through this API.** `GET` answers whether
//! one is registered and nothing more — no prefix, no length, no masked form.
//! A masked key is still a leak of length and alphabet, and there is no screen
//! that needs it: a user who has lost their key rotates it at Cursor and pastes
//! a new one.

use std::sync::Arc;

use axum::{
    Router,
    extract::FromRef,
    routing::{get, put},
};
use bots::domain::ports::BotService;
use cursor_api_key::cipher::CursorApiKeyCipher;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use sqlx::PgPool;

pub mod delete_cursor_api_key;
pub mod get_cursor_api_key;
pub mod list_cursor_models;
pub mod put_cursor_api_key;
pub mod put_cursor_default_model;

/// State for the Cursor connection routes.
pub struct CursorApiKeyState<Bots, Auth> {
    db: PgPool,
    cipher: Arc<dyn CursorApiKeyCipher>,
    /// Base URL of Cursor's API, for validating keys and listing models.
    cursor_api_base_url: String,
    bots: Arc<Bots>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Bots, Auth> Clone for CursorApiKeyState<Bots, Auth> {
    fn clone(&self) -> Self {
        Self {
            db: self.db.clone(),
            cipher: self.cipher.clone(),
            cursor_api_base_url: self.cursor_api_base_url.clone(),
            bots: self.bots.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Bots: BotService, Auth> CursorApiKeyState<Bots, Auth> {
    /// Create a router state.
    pub fn new(
        db: PgPool,
        cipher: Arc<dyn CursorApiKeyCipher>,
        cursor_api_base_url: String,
        bots: Arc<Bots>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            db,
            cipher,
            cursor_api_base_url,
            bots,
            authorization_state,
        }
    }
}

impl<Bots, Auth> FromRef<CursorApiKeyState<Bots, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &CursorApiKeyState<Bots, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Routes for the settings surface's Cursor connection, under `/cursor-api-key`.
pub fn cursor_api_key_router<Bots, Auth, T>(state: CursorApiKeyState<Bots, Auth>) -> Router<T>
where
    Bots: BotService,
    Auth: MacroAuthorizationService,
    T: Send + Sync,
{
    Router::new()
        .route(
            "/cursor-api-key",
            get(get_cursor_api_key::handler::<Bots, Auth>)
                .put(put_cursor_api_key::handler::<Bots, Auth>)
                .delete(delete_cursor_api_key::handler::<Bots, Auth>),
        )
        // The models this account may pick from, for the settings dropdown.
        .route(
            "/cursor-api-key/models",
            get(list_cursor_models::handler::<Bots, Auth>),
        )
        // The model the Cursor agent is seeded with.
        .route(
            "/cursor-api-key/default-model",
            put(put_cursor_default_model::handler::<Bots, Auth>),
        )
        .with_state(state)
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

impl CursorApiKeyStatus {
    fn from_stored(stored: Option<cursor_api_key::store::StoredCursorConfig>) -> Self {
        Self {
            registered: stored.is_some(),
            default_model_id: stored.as_ref().and_then(|s| s.default_model_id.clone()),
            updated_at: stored.map(|stored| stored.updated_at),
        }
    }
}

/// Everything the handlers can fail with.
#[derive(Debug, thiserror::Error)]
pub enum CursorApiKeyError {
    /// The supplied value does not look like a Cursor API key.
    #[error("value does not look like a Cursor API key")]
    MalformedKey,
    /// An operation that needs a connected account was attempted without one,
    /// such as listing the account's available models before pasting a key.
    #[error("connect a Cursor API key first")]
    NotConnected,
    /// Cursor's own API could not be reached or refused the request — listing
    /// models, say. Distinct from [`Self::Internal`] so the client can tell
    /// "Cursor is having a moment" from "we broke".
    #[error("Cursor's API is unavailable right now")]
    CursorUnavailable,
    /// Cursor's account offered no model to seed the agent with.
    #[error("Cursor offered no models for this account")]
    NoModels,
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
            Self::NotConnected => StatusCode::CONFLICT,
            Self::CursorUnavailable | Self::NoModels => StatusCode::BAD_GATEWAY,
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        // `to_string` and nothing else: every variant's message is written to
        // be safe to return, and none of them names the value that failed.
        (
            status,
            axum::Json(model_error_response::ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}
