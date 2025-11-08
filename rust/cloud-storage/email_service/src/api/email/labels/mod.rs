pub mod create;
pub mod delete;
pub mod list;

use axum::Router;
use axum::routing::{delete, get, post};

use crate::api::ApiContext;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/", post(create::handler))
        .route("/:id", delete(delete::handler))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::api::middleware::gmail_token::attach_gmail_token,
        ))
        .route("/", get(list::handler))
        .layer(axum::middleware::from_fn_with_state(
            state,
            crate::api::middleware::link::attach_link_context,
        ))
}
