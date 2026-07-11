pub mod context;
pub mod swagger;

use axum::Router;

use crate::api::context::PropertiesHandlerState;

/// Creates the properties router with the service's authentication middleware
/// applied to every route that requires an authenticated user.
pub fn router() -> Router<PropertiesHandlerState> {
    properties::inbound::axum_router::router(axum::middleware::from_fn(
        macro_middleware::auth::ensure_user_exists::handler,
    ))
}
