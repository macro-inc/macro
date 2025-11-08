use std::sync::Arc;

use crate::service::conn_gateway::update_live_comment_state;
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use connection_gateway_client::ConnectionGatewayClient;
use macro_db_client::annotations::edit_comment::edit_document_comment;
use model::{
    annotations::{
        AnnotationIncrementalUpdate,
        edit::{EditCommentRequest, EditCommentResponse},
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

/// Edits a single comment for a document
#[utoipa::path(
        patch,
        path = "/annotations/comments/comment/{comment_id}",
        params(
            ("comment_id" = i64, Path, description = "The comment id")
        ),
        operation_id = "edit_comment",
        responses(
            (status = 200, body=EditCommentResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
pub async fn edit_comment_handler(
    State(db): State<PgPool>,
    State(conn_gateway_client): State<Arc<ConnectionGatewayClient>>,
    user_context: Extension<UserContext>,
    Path(Params { comment_id }): Path<Params>,
    Json(req): Json<EditCommentRequest>,
) -> Result<Response, Response> {
    let user_id = user_context.user_id.as_str();

    // TODO: check if the user has comment access to the document
    match edit_document_comment(&db, comment_id, user_id, req).await {
        Ok(res) => {
            let response: EditCommentResponse = res;
            let document_id = response.document_id.as_str();
            update_live_comment_state(
                &conn_gateway_client,
                document_id,
                AnnotationIncrementalUpdate::EditComment {
                    sender: user_id,
                    document_id,
                    response: &response,
                },
            )
            .await;
            Ok((StatusCode::OK, Json(response)).into_response())
        }
        Err(e) => comment_error_response(e, "Error editing comment"),
    }
}
