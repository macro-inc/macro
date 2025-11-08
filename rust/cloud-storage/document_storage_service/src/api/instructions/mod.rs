use axum::{
    Router,
    routing::{get, post},
};

use crate::api::context::ApiContext;

pub(in crate::api) mod create_instructions;
pub(in crate::api) mod get_instructions;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", post(create_instructions::create_instructions_handler))
        .route("/", get(get_instructions::get_instructions_handler))
        .layer(axum::middleware::from_fn(
            macro_middleware::auth::ensure_user_exists::handler,
        ))
}
