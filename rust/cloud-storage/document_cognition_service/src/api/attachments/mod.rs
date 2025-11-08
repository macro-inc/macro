pub mod get_chats_for_attachment;
pub mod get_models_for_attachments;
pub mod verify_attachments;

use axum::{
    Router,
    routing::{get, post},
};
use tower::ServiceBuilder;

use crate::api::{
    attachments::get_models_for_attachments::get_models_for_attachments_handler,
    context::ApiContext,
};

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route(
            "/:attachment_id/chats",
            get(get_chats_for_attachment::get_chats_for_attachment_handler).layer(
                ServiceBuilder::new().layer(axum::middleware::from_fn(
                    macro_middleware::auth::ensure_user_exists::handler,
                )),
            ),
        )
        .route(
            "/verify",
            post(verify_attachments::verify_attachments_handler).layer(
                ServiceBuilder::new().layer(axum::middleware::from_fn(
                    macro_middleware::auth::ensure_user_exists::handler,
                )),
            ),
        )
        .route(
            "/get_models_for_attachments",
            post(get_models_for_attachments_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(macro_middleware::auth::ensure_user_exists::handler),
            )),
        )
}
