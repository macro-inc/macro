use axum::Router;
use context::SearchRouterState;
use macro_authorization::MacroAuthorizationService;

// Routes
pub mod search;

// Misc
pub mod context;
pub mod swagger;

/// Creates the public search router.
/// Exposes:
/// - POST / - unified search
/// - POST /simple - simple unified search
pub fn router() -> Router<SearchRouterState> {
    search::router()
}

/// Creates the search router with the supplied authorization service.
pub fn router_with_authorization<Auth>() -> Router<SearchRouterState<Auth>>
where
    Auth: MacroAuthorizationService,
{
    search::router_with_authorization()
}
