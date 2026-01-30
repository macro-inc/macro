use axum::Router;
use context::SearchHandlerState;

// Routes
mod health;
mod internal;
mod search;

// Misc
pub mod context;
pub mod swagger;

/// Creates the public search router.
/// Exposes:
/// - POST / - unified search
/// - POST /simple - simple unified search
pub fn router() -> Router<SearchHandlerState> {
    search::router()
}

/// Creates the internal search router.
/// Exposes:
/// - POST /search - internal search endpoint
/// - GET /health - internal health check
pub fn internal_router() -> Router<SearchHandlerState> {
    internal::router()
}
