use std::{collections::HashSet, sync::Arc};

use crate::{
    api::{
        annotations::{build_document_comment_notif, build_mention_notif, build_thread_reply_notif},
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
                message: "cannot modify deleted document",
            }),
        )
            .into_response());
    }
    match create_document_comment(&db, &document_id, &user_id, &req).await {
        Ok(res) => {
            if let Some(comment) = res.comment_thread.comments.last() {
                let sender_id: Option<MacroUserIdStr<'static>> =
                    user_id.clone().try_into().ok();
                let sender_profile_picture_url =
                    macro_db_client::user::update_profile_picture::get_profile_pictures(
                        &db,
                        &vec![user_id.clone()],
                    )
                    .await
                    .ok()
                    .and_then(|pics| pics.pictures.into_iter().next().map(|p| p.url));

                let mut notified_users: HashSet<String> = HashSet::new();
                let thread_id = res.comment_thread.thread.thread_id;

                // 1. Mention notifications (highest priority)
                if let Some(Mentions { users, mention_id }) = &req.mentions {
                    let request = build_mention_notif(
                        req.text.clone(),
                        comment,
                        thread_id,
                        users,
                        document_context.document_name.clone(),
                        document_context.owner.clone(),
                        document_context.file_type.clone(),
                        sender_id.clone(),
                        document_id.to_string(),
                        mention_id,
                        sender_profile_picture_url.clone(),
                    )
                    .into_request()
                    .with_apns()
                    .with_conn_gateway();

                    _ = notification_ingress_service
                        .send_notification(request)
                        .await
                        .inspect_err(|e| tracing::error!(error =? e, "couldn't send document mention notification"));

                    notified_users.extend(users.iter().cloned());
                }

                // 2. Thread reply notifications (if this is a reply to an existing thread)
                if res.comment_thread.comments.len() > 1 {
                    let thread_participant_ids: HashSet<MacroUserIdStr<'_>> = res
                        .comment_thread
                        .comments
                        .iter()
                        .filter_map(|c| MacroUserIdStr::parse_from_str(&c.owner).ok())
                        .filter(|p| {
                            let p_str = p.as_ref();
                            !notified_users.contains(p_str)
                                && sender_id.as_ref().map_or(true, |s| p != s)
                        })
                        .collect();

                    if !thread_participant_ids.is_empty() {
                        notified_users
                            .extend(thread_participant_ids.iter().map(|p| p.as_ref().to_string()));

                        let request = build_thread_reply_notif(
                            req.text.clone(),
                            comment,
                            thread_id,
                            thread_participant_ids,
                            document_context.document_name.clone(),
                            document_context.owner.clone(),
                            document_context.file_type.clone(),
                            sender_id.clone(),
                            document_id.to_string(),
                            sender_profile_picture_url.clone(),
                        )
                        .into_request()
                        .with_apns()
                        .with_conn_gateway();

                        _ = notification_ingress_service
                            .send_notification(request)
                            .await
                            .inspect_err(|e| tracing::error!(error =? e, "couldn't send thread reply notification"));
                    }
                }

                // 3. Document owner notification (lowest priority)
                {
                    let owner_str = document_context.owner.as_ref().to_string();
                    let is_sender = sender_id
                        .as_ref()
                        .map_or(false, |s| s.as_ref() == document_context.owner.as_ref());
                    if !is_sender && !notified_users.contains(&owner_str) {
                        let request = build_document_comment_notif(
                            req.text.clone(),
                            comment,
                            thread_id,
                            document_context.owner.clone(),
                            document_context.document_name.clone(),
                            document_context.file_type.clone(),
                            sender_id.clone(),
                            document_id.to_string(),
                            sender_profile_picture_url.clone(),
                        )
                        .into_request()
                        .with_apns()
                        .with_conn_gateway();

                        _ = notification_ingress_service
                            .send_notification(request)
                            .await
                            .inspect_err(|e| tracing::error!(error =? e, "couldn't send document comment notification"));
                    }
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
