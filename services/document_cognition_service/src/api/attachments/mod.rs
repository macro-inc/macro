pub mod get_chats_for_attachment;

use axum::{Router, routing::get};
use tower::ServiceBuilder;

use crate::api::context::ApiContext;

pub fn router() -> Router<ApiContext> {
    Router::new().route(
        "/{attachment_id}/chats",
        get(get_chats_for_attachment::get_chats_for_attachment_handler).layer(
            ServiceBuilder::new().layer(axum::middleware::from_fn(
                macro_middleware::auth::ensure_user_exists::handler,
            )),
        ),
    )
}
