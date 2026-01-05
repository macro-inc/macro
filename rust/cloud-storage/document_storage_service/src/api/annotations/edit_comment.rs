use std::sync::Arc;

use crate::{
    api::annotations::{NotifLocationType, build_mention_notif},
    service::conn_gateway::update_live_comment_state,
};
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
        AnnotationIncrementalUpdate, Mentions,
        edit::{EditCommentRequest, EditCommentResponse},
    },
    document::DocumentBasic,
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
    State(macro_notify_client): State<Arc<macro_notify::MacroNotify>>,
    State(conn_gateway_client): State<Arc<ConnectionGatewayClient>>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    Path(Params { comment_id }): Path<Params>,
    Json(req): Json<EditCommentRequest>,
) -> Result<Response, Response> {
    let user_id = user_context.user_id.as_str();

    // TODO: check if the user has comment access to the document
    match edit_document_comment(&db, comment_id, user_id, &req).await {
        Ok(res) => {
            let document_id = res.document_id.as_str();
            if let Some(Mentions { users, mention_id }) = req.mentions {
                let notif = build_mention_notif(
                    NotifLocationType::EditComment,
                    req.text.clone().unwrap_or_else(|| "".to_string()),
                    Some(&res.comment),
                    req.thread_id,
                    &users,
                    &document_context,
                    &user_context,
                    document_id.to_string(),
                    &mention_id,
                );
                _ = macro_notify_client
                    .send_notification(notif)
                    .await
                    .inspect_err(|e| tracing::error!(error =? e, "coundn't send document mention notification"));
            }
            update_live_comment_state(
                &conn_gateway_client,
                document_id,
                AnnotationIncrementalUpdate::EditComment {
                    sender: user_id,
                    document_id,
                    response: &res,
                },
            )
            .await;
            Ok((StatusCode::OK, Json(res)).into_response())
        }
        Err(e) => comment_error_response(e, "Error editing comment"),
    }
}
