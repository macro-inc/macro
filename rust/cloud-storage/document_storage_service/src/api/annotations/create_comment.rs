use std::sync::Arc;

use crate::{api::context::ApiContext, service::conn_gateway::update_live_comment_state};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use connection_gateway_client::ConnectionGatewayClient;
use macro_db_client::annotations::create_comment::create_document_comment;
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::{
    annotations::{
        AnnotationIncrementalUpdate,
        create::{CreateCommentRequest, CreateCommentResponse},
    },
    document::DocumentBasic,
    response::ErrorResponse,
    user::UserContext,
};
use models_permissions::share_permission::access_level::CommentAccessLevel;
use sqlx::PgPool;

use super::comment_error_response;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Creates a single comment for a document
/// Optionally creates a new thread/anchor if one does not exist
#[utoipa::path(
        post,
        path = "/annotations/comments/document/:document_id",
        params(
            ("document_id" = String, Path, description = "The document id")
        ),
        operation_id = "create_comment",
        responses(
            (status = 200, body=CreateCommentResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[axum::debug_handler(state = ApiContext)]
pub async fn create_comment_handler(
    _access: DocumentAccessExtractor<CommentAccessLevel>,
    State(db): State<PgPool>,
    State(conn_gateway_client): State<Arc<ConnectionGatewayClient>>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    Json(req): Json<CreateCommentRequest>,
) -> Result<Response, Response> {
    if document_context.deleted_at.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "cannot modify deleted document",
            }),
        )
            .into_response());
    }
    let user_id = user_context.user_id.as_str();
    let document_id = document_id.as_str();
    match create_document_comment(&db, document_id, user_id, req).await {
        Ok(res) => {
            let response: CreateCommentResponse = res;
            update_live_comment_state(
                &conn_gateway_client,
                document_id,
                AnnotationIncrementalUpdate::CreateComment {
                    sender: user_id,
                    document_id,
                    response: &response,
                },
            )
            .await;
            Ok((StatusCode::OK, Json(response)).into_response())
        }
        Err(e) => comment_error_response(e, "Error creating comment"),
    }
}
