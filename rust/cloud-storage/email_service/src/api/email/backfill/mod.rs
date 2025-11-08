pub(crate) mod cancel;
pub(crate) mod get;

use axum::Router;
use axum::routing::{delete, get};

use crate::api::ApiContext;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/gmail", delete(cancel::handler))
        .route("/gmail/:id", get(get::handler))
        .layer(axum::middleware::from_fn_with_state(
            state,
            crate::api::middleware::link::attach_link_context,
        ))
}
