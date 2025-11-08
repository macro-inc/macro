pub mod upsert_document_text;
use axum::{Router, routing::post};
use tower::ServiceBuilder;

use crate::api::context::ApiContext;

pub fn router() -> Router<ApiContext> {
    Router::new().route(
        "/:document_id",
        post(upsert_document_text::upsert_text_handler).layer(ServiceBuilder::new().layer(
            axum::middleware::from_fn(macro_middleware::auth::ensure_user_exists::handler),
        )),
    )
}
