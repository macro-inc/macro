use axum::Router;
use context::SearchHandlerState;

// Routes
pub mod search;

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
