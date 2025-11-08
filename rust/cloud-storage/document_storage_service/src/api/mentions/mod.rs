use super::context::ApiContext;
use axum::{Router, routing::post};

pub(in crate::api) mod upsert_user_mentions;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new().route(
        "/:document_id",
        post(upsert_user_mentions::handler).layer(axum::middleware::from_fn_with_state(
            state,
            macro_middleware::cloud_storage::document::ensure_document_exists::handler,
        )),
    )
}
