pub(crate) mod create;
pub(crate) mod delete;

use axum::Router;
use axum::routing::{delete, post};

use crate::api::ApiContext;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/", post(create::handler))
        .route("/:id", delete(delete::handler))
        .layer(axum::middleware::from_fn_with_state(
            state,
            crate::api::middleware::link::attach_link_context,
        ))
}
