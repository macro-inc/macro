pub(crate) mod get;
pub(crate) mod labels;
pub(crate) mod send;

use axum::Router;
use axum::routing::{get, patch, post};

use crate::api::ApiContext;

const BATCH_UPDATE_MESSAGE_LIMIT: usize = 10;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route(
            "/",
            post(send::send_handler).layer(axum::middleware::from_fn_with_state(
                state.clone(),
                crate::api::middleware::gmail_token::attach_gmail_token,
            )),
        )
        .route(
            "/labels",
            patch(labels::handler).layer(axum::middleware::from_fn_with_state(
                state.clone(),
                crate::api::middleware::gmail_token::attach_gmail_token,
            )),
        )
        .route("/batch", post(get::batch_handler))
        .layer(axum::middleware::from_fn_with_state(
            state.email_service,
            crate::api::middleware::link::attach_link_context,
        ))
        .route("/:id", get(get::handler))
}
