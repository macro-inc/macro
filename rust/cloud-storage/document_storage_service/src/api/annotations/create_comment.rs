use std::sync::Arc;

use crate::{
    api::{
        annotations::{CommentNotifContext, compute_notification_recipients},
        context::ApiContext,
    },
    service::conn_gateway::update_live_comment_state,
};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use connection_gateway_client::ConnectionGatewayClient;
use macro_db_client::annotations::create_comment::create_document_comment;
use macro_user_id::user_id::MacroUserIdStr;
use model::{
    annotations::{
        AnnotationIncrementalUpdate, Mentions,
        create::{CreateCommentRequest, CreateCommentResponse},
    },
    document::DocumentBasic,
    response::ErrorResponse,
    user::UserContext,
};
use notification::domain::service::NotificationIngress;
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
        path = "/annotations/comments/document/{document_id}",
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
    State(notification_ingress_service): State<Arc<crate::api::context::NotificationIngressType>>,
    State(db): State<PgPool>,
    State(conn_gateway_client): State<Arc<ConnectionGatewayClient>>,
    Extension(UserContext { user_id, .. }): Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    Json(req): Json<CreateCommentRequest>,
) -> Result<Response, Response> {
    if document_context.deleted_at.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "cannot modify deleted document".into(),
            }),
        )
            .into_response());
    }
    match create_document_comment(&db, &document_id, &user_id, &req).await {
        Ok(res) => {
            if let Some(comment) = res.comment_thread.comments.last() {
                let sender_id: Option<MacroUserIdStr<'static>> = user_id.clone().try_into().ok();
                let sender_profile_picture_url =
                    macro_db_client::user::update_profile_picture::get_profile_pictures(
                        &db,
                        &vec![user_id.clone()],
                    )
                    .await
                    .ok()
                    .and_then(|pics| pics.pictures.into_iter().next().map(|p| p.url));

                let thread_id = res.comment_thread.thread.thread_id;
                let is_reply = res.comment_thread.comments.len() > 1;
                let mentioned_user_ids = req
                    .mentions
                    .as_ref()
                    .map(|m| m.users.as_slice())
                    .unwrap_or_default();
                let thread_comment_owners: Vec<String> = res
                    .comment_thread
                    .comments
                    .iter()
                    .map(|c| c.owner.clone())
                    .collect();

                let recipients = compute_notification_recipients(
                    sender_id.as_ref(),
                    mentioned_user_ids,
                    &thread_comment_owners,
                    &document_context.owner,
                    is_reply,
                );

                let notif_ctx = CommentNotifContext {
                    text: req.text.clone(),
                    comment_id: comment.comment_id,
                    thread_id,
                    document_name: document_context.document_name.clone(),
                    document_id: document_id.to_string(),
                    owner: document_context.owner.clone(),
                    file_type: document_context.file_type.clone(),
                    sender_id: sender_id.clone(),
                    sender_profile_picture_url,
                };

                // 1. Mention notifications (highest priority)
                if let Some(Mentions { mention_id, .. }) = &req.mentions
                    && !recipients.mention_recipients.is_empty()
                {
                    let request = notif_ctx
                        .build_mention_notif(recipients.mention_recipients, mention_id)
                        .into_request()
                        .with_apns()
                        .with_conn_gateway();

                    _ = notification_ingress_service
                        .send_notification(request)
                        .await
                        .inspect_err(|e| tracing::error!(error =? e, "couldn't send document mention notification"));
                }

                // 2. Thread reply notifications
                if !recipients.thread_reply_recipients.is_empty() {
                    let request = notif_ctx
                        .build_thread_reply_notif(recipients.thread_reply_recipients)
                        .into_request()
                        .with_apns()
                        .with_conn_gateway();

                    _ = notification_ingress_service
                        .send_notification(request)
                        .await
                        .inspect_err(|e| tracing::error!(error =? e, "couldn't send thread reply notification"));
                }

                // 3. Document owner notification (lowest priority)
                if recipients.doc_owner_recipient.is_some() {
                    let request = notif_ctx
                        .build_document_comment_notif()
                        .into_request()
                        .with_apns()
                        .with_conn_gateway();

                    _ = notification_ingress_service
                        .send_notification(request)
                        .await
                        .inspect_err(|e| tracing::error!(error =? e, "couldn't send document comment notification"));
                }
            }
            update_live_comment_state(
                &conn_gateway_client,
                &document_id,
                AnnotationIncrementalUpdate::CreateComment {
                    sender: &user_id,
                    document_id: &document_id,
                    response: &res,
                },
            )
            .await;
            Ok((StatusCode::OK, Json(res)).into_response())
        }
        Err(e) => comment_error_response(e, "Error creating comment"),
    }
}
