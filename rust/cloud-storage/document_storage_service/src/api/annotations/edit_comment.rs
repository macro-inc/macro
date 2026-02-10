use std::sync::Arc;

use crate::{
    api::annotations::build_mention_notif, service::conn_gateway::update_live_comment_state,
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
    response::ErrorResponse,
    user::UserContext,
};
use notification::domain::service::{NotificationIngress, NotificationIngressService};
use notification::outbound::{queue::SqsNotificationQueue, repository::DbNotificationRepository};
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
    State(notification_ingress_service): State<
        Arc<NotificationIngressService<DbNotificationRepository<PgPool>, SqsNotificationQueue>>,
    >,
    State(conn_gateway_client): State<Arc<ConnectionGatewayClient>>,
    Extension(UserContext { user_id, .. }): Extension<UserContext>,
    Path(Params { comment_id }): Path<Params>,
    Json(req): Json<EditCommentRequest>,
) -> Result<Response, Response> {
    // TODO: check if the user has comment access to the document
    match edit_document_comment(&db, comment_id, &user_id, &req).await {
        Ok(res) => {
            if let Some(Mentions { users, mention_id }) = req.mentions {
                let request = build_mention_notif(
                    req.text.clone().unwrap_or_else(|| "".to_string()),
                    &res.comment,
                    req.thread_id,
                    &users,
                    res.document_name.clone(),
                    res.document_owner.clone(),
                    res.file_type.clone(),
                    user_id.clone().try_into().ok(),
                    res.document_id.to_string(),
                    &mention_id,
                )
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
