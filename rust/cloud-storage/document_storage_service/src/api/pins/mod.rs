use super::context::ApiContext;
use axum::{
    Router,
    routing::{delete, get, patch, post},
};

// needs to be public in api crate for swagger
pub(in crate::api) mod add_pin;
pub(in crate::api) mod get_pins;
pub(in crate::api) mod remove_pin;
pub(in crate::api) mod reorder_pins;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(get_pins::get_pins_handler))
        .route("/:pinned_item_id", post(add_pin::add_pin_handler))
        .route("/:pinned_item_id", delete(remove_pin::remove_pin_handler))
        .route("/", patch(reorder_pins::reorder_pins_handler))
        .layer(axum::middleware::from_fn(
            macro_middleware::auth::ensure_user_exists::handler,
        ))
}
