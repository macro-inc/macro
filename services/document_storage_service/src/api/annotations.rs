pub mod create_anchor;
pub mod delete_anchor;
pub mod edit_anchor;
pub mod get;

use super::context::ApiContext;
use axum::{
    Json, Router,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get},
};
use model::response::ErrorResponse;
use tower::ServiceBuilder;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route(
            "/anchors",
            delete(delete_anchor::delete_anchor_handler).patch(edit_anchor::edit_anchor_handler),
        )
        .route(
            "/anchors/document/{document_id}",
            get(get::get_document_anchors_handler)
                .post(create_anchor::create_anchor_handler)
                .layer(
                    ServiceBuilder::new().layer(axum::middleware::from_fn_with_state(
                        state,
                        macro_middleware::cloud_storage::document::ensure_document_exists::handler,
                    )),
                ),
        )
}

pub fn annotation_error_response(error: anyhow::Error, message: &str) -> Response {
    tracing::error!(error = ?error, "annotation persistence failed");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
        .into_response()
}
