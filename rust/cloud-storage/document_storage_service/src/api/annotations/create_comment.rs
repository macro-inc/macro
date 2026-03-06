use std::sync::Arc;

use crate::{
    api::{annotations::build_mention_notif, context::ApiContext},
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
            if let Some(Mentions { users, mention_id }) = &req.mentions
                && let Some(comment) = res.comment_thread.comments.first()
            {
                let sender_profile_picture_url =
                    macro_db_client::user::update_profile_picture::get_profile_pictures(
                        &db,
                        &vec![user_id.clone()],
                    )
                    .await
                    .ok()
                    .and_then(|pics| pics.pictures.into_iter().next().map(|p| p.url));

                let request = build_mention_notif(
                    req.text,
                    comment,
                    res.comment_thread.thread.thread_id,
                    users,
                    document_context.document_name.clone(),
                    document_context.owner.clone(),
                    document_context.file_type.clone(),
                    user_id.clone().try_into().ok(),
                    document_id.to_string(),
                    mention_id,
                    sender_profile_picture_url,
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
