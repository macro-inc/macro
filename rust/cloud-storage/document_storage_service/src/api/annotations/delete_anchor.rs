use std::sync::Arc;

use crate::{api::context::ApiContext, service::conn_gateway::update_live_comment_state};
use axum::{
    Json,
    extract::{Extension, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use connection_gateway_client::ConnectionGatewayClient;
use macro_db_client::annotations::delete_anchor::delete_document_anchor;
use model::{
    annotations::{
        AnnotationIncrementalUpdate,
        delete::{DeleteUnthreadedAnchorRequest, DeleteUnthreadedAnchorResponse},
    },
    response::ErrorResponse,
    user::UserContext,
};
use sqlx::PgPool;

use super::comment_error_response;

/// Deletes a single unthreaded anchor for a document
/// If you need to delete a threaded anchor, see the delete comment handler
#[utoipa::path(
        delete,
        path = "/annotations/anchors",
        operation_id = "delete_anchor",
        responses(
            (status = 200, body=DeleteUnthreadedAnchorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[axum::debug_handler(state = ApiContext)]
pub async fn delete_anchor_handler(
    State(db): State<PgPool>,
    State(conn_gateway_client): State<Arc<ConnectionGatewayClient>>,
    user_context: Extension<UserContext>,
    Json(req): Json<DeleteUnthreadedAnchorRequest>,
) -> Result<Response, Response> {
    let user_id = user_context.user_id.as_str();
    match delete_document_anchor(&db, user_id, req).await {
        Ok(res) => {
            let response: DeleteUnthreadedAnchorResponse = res;
            let document_id = response.document_id.as_str();
            update_live_comment_state(
                &conn_gateway_client,
                document_id,
                AnnotationIncrementalUpdate::DeleteUnthreadedAnchor {
                    sender: user_id,
                    document_id,
                    response: &response,
                },
            )
            .await;
            Ok((StatusCode::OK, Json(response)).into_response())
        }
        Err(e) => comment_error_response(e, "Error deleting anchor"),
    }
}
