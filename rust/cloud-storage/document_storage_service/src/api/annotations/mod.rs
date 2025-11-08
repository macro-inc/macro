pub mod create_anchor;
pub mod create_comment;
pub mod delete_anchor;
pub mod delete_comment;
pub mod edit_anchor;
pub mod edit_comment;
pub mod get;

use super::context::ApiContext;
use axum::{
    Json, Router,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
};
use macro_db_client::annotations::CommentError;
use model::response::ErrorResponse;
use tower::ServiceBuilder;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route(
            "/comments/document/:document_id",
            get(get::get_document_comments_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    macro_middleware::cloud_storage::document::ensure_document_exists::handler,
                ),
            )),
        )
        .route(
            "/comments/document/:document_id",
            post(create_comment::create_comment_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    macro_middleware::cloud_storage::document::ensure_document_exists::handler,
                ),
            )),
        )
        .route(
            "/comments/comment/:comment_id",
            delete(delete_comment::delete_comment_handler),
        )
        .route("/anchors", delete(delete_anchor::delete_anchor_handler))
        .route("/anchors", patch(edit_anchor::edit_anchor_handler))
        .route(
            "/comments/comment/:comment_id",
            patch(edit_comment::edit_comment_handler),
        )
        .route(
            "/anchors/document/:document_id",
            get(get::get_document_anchors_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    macro_middleware::cloud_storage::document::ensure_document_exists::handler,
                ),
            )),
        )
        .route(
            "/anchors/document/:document_id",
            post(create_anchor::create_anchor_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    macro_middleware::cloud_storage::document::ensure_document_exists::handler,
                ),
            )),
        )
}

#[expect(clippy::result_large_err, reason = "too annoying to fix now")]
pub fn comment_error_response(e: anyhow::Error, default_msg: &str) -> Result<Response, Response> {
    match e.downcast_ref::<CommentError>() {
        Some(CommentError::CommentNotFound) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: e.to_string().as_ref(),
            }),
        )
            .into_response()),
        Some(CommentError::ThreadNotFound) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: e.to_string().as_ref(),
            }),
        )
            .into_response()),
        Some(CommentError::AnchorNotFound) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: e.to_string().as_ref(),
            }),
        )
            .into_response()),
        Some(CommentError::InvalidPermissions) => Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                message: e.to_string().as_ref(),
            }),
        )
            .into_response()),
        Some(CommentError::NotAllowed(msg)) => Err((
            StatusCode::METHOD_NOT_ALLOWED,
            Json(ErrorResponse { message: msg }),
        )
            .into_response()),
        None => {
            tracing::error!(error = ?e, "unknown error occurred");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: default_msg,
                }),
            )
                .into_response())
        }
    }
}
