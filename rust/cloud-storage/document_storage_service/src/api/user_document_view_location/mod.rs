use super::context::ApiContext;
use axum::{
    Router,
    routing::{delete, get, post},
};

pub(in crate::api) mod delete_user_document_view_location;
pub(in crate::api) mod get_user_document_view_location;
pub(in crate::api) mod upsert_user_document_view_location;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route(
            "/:document_id",
            get(get_user_document_view_location::handler),
        )
        .route(
            "/:document_id",
            post(upsert_user_document_view_location::handler),
        )
        .route(
            "/:document_id",
            delete(delete_user_document_view_location::handler),
        )
        .layer(axum::middleware::from_fn_with_state(
            state,
            macro_middleware::cloud_storage::document::ensure_document_exists::handler,
        ))
}
