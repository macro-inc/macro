use std::sync::Arc;

use crate::{
    api::annotations::CommentNotifContext, service::conn_gateway::update_live_comment_state,
};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use connection_gateway_client::ConnectionGatewayClient;
use macro_db_client::annotations::edit_comment::edit_document_comment;
use macro_user_id::user_id::MacroUserIdStr;
use model::{
    annotations::{
        AnnotationIncrementalUpdate, Mentions,
        edit::{EditCommentRequest, EditCommentResponse},
    },
    response::ErrorResponse,
    user::UserContext,
};
use notification::domain::service::NotificationIngress;
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
    State(notification_ingress_service): State<Arc<crate::api::context::NotificationIngressType>>,
    State(conn_gateway_client): State<Arc<ConnectionGatewayClient>>,
    Extension(UserContext { user_id, .. }): Extension<UserContext>,
    Path(Params { comment_id }): Path<Params>,
    Json(req): Json<EditCommentRequest>,
) -> Result<Response, Response> {
    // TODO: check if the user has comment access to the document
    match edit_document_comment(&db, comment_id, &user_id, &req).await {
        Ok(res) => {
            if let Some(Mentions { users, mention_id }) = req.mentions {
                let sender_profile_picture_url =
                    macro_db_client::user::update_profile_picture::get_profile_pictures(
                        &db,
                        &vec![user_id.clone()],
                    )
                    .await
                    .ok()
                    .and_then(|pics| pics.pictures.into_iter().next().map(|p| p.url));

                // Only mention notifications on edit — no thread-reply or document-owner
                // notifications, since edits shouldn't re-notify participants.
                let notif_ctx = CommentNotifContext {
                    text: req.text.clone().unwrap_or_default(),
                    comment_id: res.comment.comment_id,
                    thread_id: req.thread_id,
                    document_name: res.document_name.clone(),
                    document_id: res.document_id.to_string(),
                    owner: res.document_owner.clone(),
                    file_type: res.file_type.clone(),
                    sender_id: user_id.clone().try_into().ok(),
                    sender_profile_picture_url,
                };

                let recipient_ids = users
                    .iter()
                    .filter_map(|id| MacroUserIdStr::try_from(id.clone()).ok())
                    .collect();

                let request = notif_ctx
                    .build_mention_notif(recipient_ids, &mention_id)
                    .into_request()
                    .with_apns()
                    .with_conn_gateway();

                _ = notification_ingress_service
                    .send_notification(request)
                    .await
                    .inspect_err(|e| tracing::error!(error =? e, "couldn't send document mention notification"));
            }
            update_live_comment_state(
                &conn_gateway_client,
                &res.document_id,
                AnnotationIncrementalUpdate::EditComment {
                    sender: &user_id,
                    document_id: &res.document_id,
                    response: &res,
                },
            )
            .await;
            Ok((StatusCode::OK, Json(res)).into_response())
        }
        Err(e) => comment_error_response(e, "Error editing comment"),
    }
}
