//! API endpoints for ID mapping operations.
//!
//! Provides a simple key-value store for mapping source IDs to target IDs.

use axum::{
    Router,
    routing::{get, post},
};
use tower::ServiceBuilder;

use crate::api::context::ApiContext;

mod create;
mod get_mapping;

/// Creates the router for id_mapping endpoints.
pub fn router() -> Router<ApiContext> {
    Router::new()
        .route(
            "/{source_id}",
            post(create::create_id_mapping_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(macro_middleware::auth::ensure_user_exists::handler),
            )),
        )
        .route(
            "/{source_id}",
            get(get_mapping::get_id_mapping_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(macro_middleware::auth::ensure_user_exists::handler),
            )),
        )
}
