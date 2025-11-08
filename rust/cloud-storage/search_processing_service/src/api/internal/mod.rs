use crate::api::ApiContext;
use axum::{
    Router,
    routing::{delete, post},
};

pub(in crate::api) mod delete_document;
pub(in crate::api) mod extract_sync;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/delete/:document_id", delete(delete_document::handler))
        .route("/extract_sync", post(extract_sync::handler))
}
