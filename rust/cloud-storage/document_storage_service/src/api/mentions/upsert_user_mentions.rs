use std::sync::Arc;

use crate::model::request::documents::user_mentions::UpsertUserMentionsRequest;
use axum::{
    Extension,
    extract::{Json, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::user::UserContext;
use model::{
    document::DocumentBasic,
    response::{EmptyResponse, GenericErrorResponse, GenericResponse},
};
use model_notifications::{
    DocumentMentionMetadata, NotificationEntity, NotificationEvent, NotificationQueueMessage,
};
use models_permissions::share_permission::access_level::CommentAccessLevel;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

#[utoipa::path(
    post,
    operation_id="upsert_user_mentions",
    path = "/mentions/{document_id}",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, body=EmptyResponse),
        (status = 400, body=GenericErrorResponse),
        (status = 401, body=GenericErrorResponse),
        (status = 500, body=GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(macro_notify_client, user_context, req), fields(user_id=?user_context.user_id))]
pub async fn handler(
    axxess: DocumentAccessExtractor<CommentAccessLevel>,
    State(macro_notify_client): State<Arc<macro_notify::MacroNotify>>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    Json(req): Json<UpsertUserMentionsRequest>,
) -> impl IntoResponse {
    if document_context.deleted_at.is_some() {
        return GenericResponse::builder()
            .message("cannot modify deleted document")
            .is_error(true)
            .send(StatusCode::BAD_REQUEST);
    }

    if !req.mentions.is_empty() {
        let metadata = DocumentMentionMetadata {
            document_name: document_context.document_name.clone(),
            owner: document_context.owner.clone(),
            file_type: document_context.file_type.clone(),
            metadata: req.metadata,
        };

        let notification_queue_message = NotificationQueueMessage {
            notification_entity: NotificationEntity::new_document(document_id),
            notification_event: NotificationEvent::DocumentMention(metadata),
            sender_id: Some(user_context.user_id.clone()),
            recipient_ids: Some(req.mentions.clone()),
            is_important_v0: Some(false),
        };

        if let Err(err) = macro_notify_client
            .send_notification(notification_queue_message)
            .await
        {
            tracing::error!(error=?err, "unable to send notification");
            return GenericResponse::builder()
                .message("unable to send notification")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    (StatusCode::OK, Json(EmptyResponse::default())).into_response()
}
