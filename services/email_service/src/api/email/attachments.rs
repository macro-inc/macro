use crate::api::ApiContext;
use axum::{Router, routing::get};
pub(crate) mod get;
pub(crate) mod get_document_id;

pub fn router(_state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/{id}", get(get::handler))
        .route("/{id}/document_id", get(get_document_id::handler))
}
