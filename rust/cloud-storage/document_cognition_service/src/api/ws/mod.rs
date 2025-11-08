mod attachment_permissions;
pub mod chat_message;
pub mod chat_permissions;
pub mod completion;
pub mod connection;
pub mod edit_message;
pub mod error;
pub mod extraction_status;
pub mod select_model;
pub mod simple_completion;

use axum::{Router, routing::get};
use tower::ServiceBuilder;

use crate::api::context::ApiContext;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new().route(
        "/",
        get(connection::ws_handler).layer(
            ServiceBuilder::new()
                .layer(axum::middleware::from_fn(
                    macro_middleware::auth::ensure_user_exists::handler,
                ))
                .layer(axum::middleware::from_fn_with_state(
                    state,
                    macro_middleware::user_permissions::attach_user_permissions::handler,
                )),
        ),
    )
}
