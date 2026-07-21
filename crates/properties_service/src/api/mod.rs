pub mod context;
pub mod swagger;

use axum::Router;
use macro_authorization::MacroAuthorizationService;

use crate::api::context::PropertiesHandlerState;

/// Creates the properties router backed by the default request authorization service.
pub fn router() -> Router<PropertiesHandlerState> {
    router_with_authorization()
}

/// Creates the properties router with the supplied request authorization service.
pub fn router_with_authorization<Auth>() -> Router<PropertiesHandlerState<Auth>>
where
    Auth: MacroAuthorizationService,
{
    properties::inbound::axum_router::router()
}
