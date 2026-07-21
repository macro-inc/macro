pub mod context;
pub mod swagger;

use axum::Router;

use crate::api::context::PropertiesHandlerState;

/// Creates the properties router backed by the request authorization service.
pub fn router() -> Router<PropertiesHandlerState> {
    properties::inbound::axum_router::router()
}
