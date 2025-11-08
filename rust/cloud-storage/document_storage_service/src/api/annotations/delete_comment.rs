use std::sync::Arc;

use crate::{api::context::ApiContext, service::conn_gateway::update_live_comment_state};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use connection_gateway_client::ConnectionGatewayClient;
use macro_db_client::annotations::delete_comment::delete_document_comment;
use model::{
    annotations::{
        AnnotationIncrementalUpdate,
        delete::{DeleteCommentRequest, DeleteCommentResponse},
    },
    response::ErrorResponse,
    user::UserContext,
};
use sqlx::PgPool;

use super::comment_error_response;

#[derive(serde::Deserialize)]
pub struct Params {
    pub comment_id: i64,
}

/// Deletes a single comment for a document
#[utoipa::path(
        delete,
        path = "/annotations/comments/comment/{comment_id}",
        params(
            ("comment_id" = i64, Path, description = "The comment id")
        ),
        operation_id = "delete_comment",
        responses(
            (status = 200, body=DeleteCommentResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[axum::debug_handler(state = ApiContext)]
pub async fn delete_comment_handler(
    State(db): State<PgPool>,
    State(conn_gateway_client): State<Arc<ConnectionGatewayClient>>,
    user_context: Extension<UserContext>,
    Path(Params { comment_id }): Path<Params>,
    Json(req): Json<DeleteCommentRequest>,
) -> Result<Response, Response> {
    let user_id = user_context.user_id.as_str();
    match delete_document_comment(&db, comment_id, user_id, req).await {
        Ok(res) => {
            let response: DeleteCommentResponse = res;
            let document_id = response.document_id.as_str();
            update_live_comment_state(
                &conn_gateway_client,
                document_id,
                AnnotationIncrementalUpdate::DeleteComment {
                    sender: user_id,
                    document_id,
                    response: &response,
                },
            )
            .await;
            Ok((StatusCode::OK, Json(response)).into_response())
        }
        Err(e) => comment_error_response(e, "Error deleting comment"),
    }
}
