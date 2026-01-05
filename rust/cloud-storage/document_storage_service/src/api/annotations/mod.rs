pub mod create_anchor;
pub mod create_comment;
pub mod delete_anchor;
pub mod delete_comment;
pub mod edit_anchor;
pub mod edit_comment;
pub mod get;

use std::fmt::Display;

use super::context::ApiContext;
use axum::{
    Json, Router,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
};
use macro_db_client::annotations::CommentError;
use macro_user_id::user_id::MacroUserIdStr;
use model::{annotations::Comment, document::DocumentBasic, response::ErrorResponse};
use model_entity::EntityType;
use model_notifications::{DocumentMentionMetadata, NotificationQueueMessage};
use serde::Serialize;
use tower::ServiceBuilder;
use utoipa::ToSchema;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route(
            "/comments/document/:document_id",
            get(get::get_document_comments_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    macro_middleware::cloud_storage::document::ensure_document_exists::handler,
                ),
            )),
        )
        .route(
            "/comments/document/:document_id",
            post(create_comment::create_comment_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    macro_middleware::cloud_storage::document::ensure_document_exists::handler,
                ),
            )),
        )
        .route(
            "/comments/comment/:comment_id",
            delete(delete_comment::delete_comment_handler),
        )
        .route("/anchors", delete(delete_anchor::delete_anchor_handler))
        .route("/anchors", patch(edit_anchor::edit_anchor_handler))
        .route(
            "/comments/comment/:comment_id",
            patch(edit_comment::edit_comment_handler),
        )
        .route(
            "/anchors/document/:document_id",
            get(get::get_document_anchors_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    macro_middleware::cloud_storage::document::ensure_document_exists::handler,
                ),
            )),
        )
        .route(
            "/anchors/document/:document_id",
            post(create_anchor::create_anchor_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    macro_middleware::cloud_storage::document::ensure_document_exists::handler,
                ),
            )),
        )
}

#[expect(clippy::result_large_err, reason = "too annoying to fix now")]
pub fn comment_error_response(e: anyhow::Error, default_msg: &str) -> Result<Response, Response> {
    match e.downcast_ref::<CommentError>() {
        Some(CommentError::CommentNotFound) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: e.to_string().as_ref(),
            }),
        )
            .into_response()),
        Some(CommentError::ThreadNotFound) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: e.to_string().as_ref(),
            }),
        )
            .into_response()),
        Some(CommentError::AnchorNotFound) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: e.to_string().as_ref(),
            }),
        )
            .into_response()),
        Some(CommentError::InvalidPermissions) => Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                message: e.to_string().as_ref(),
            }),
        )
            .into_response()),
        Some(CommentError::NotAllowed(msg)) => Err((
            StatusCode::METHOD_NOT_ALLOWED,
            Json(ErrorResponse { message: msg }),
        )
            .into_response()),
        None => {
            tracing::error!(error = ?e, "unknown error occurred");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: default_msg,
                }),
            )
                .into_response())
        }
    }
}

#[derive(ToSchema)]
pub enum NotifLocationType {
    CreateComment,
    EditComment,
}
impl Serialize for NotifLocationType {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.collect_str(self)
    }
}

// NB: We ulse this Display impl for `impl Serialize for NotifLocationType`.
impl Display for NotifLocationType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}",
            match self {
                NotifLocationType::CreateComment => "create-comment",
                NotifLocationType::EditComment => "edit-comment",
            }
        )
    }
}

#[allow(clippy::too_many_arguments)]
fn build_mention_notif(
    notif_location_type: NotifLocationType,
    text: String,
    comment: Option<&Comment>,
    thread_id: i64,
    mentions: &[String],
    document_context: &DocumentBasic,
    sender_id: Option<MacroUserIdStr<'static>>,
    document_id: String,
    mention_id: &str,
) -> NotificationQueueMessage {
    let metadata = DocumentMentionMetadata {
        document_name: document_context.document_name.clone(),
        owner: document_context.owner.clone(),
        file_type: document_context.file_type.clone(),
        metadata: Some(serde_json::json!({
            "mention_id": mention_id,
            "location": {
                r#"type"#: notif_location_type,
                "commentId": comment,
                "threadId": thread_id,
                "text": text,
            }
        })),
    };

    NotificationQueueMessage {
        notification_entity: EntityType::Document.with_entity_string(document_id),
        notification_event: metadata.into(),
        sender_id,
        recipient_ids: Some(mentions.to_vec()),
    }
}

#[cfg(test)]
mod tests {
    use crate::api::annotations::NotifLocationType;

    #[test]
    fn check_deser() -> Result<(), Box<dyn std::error::Error>> {
        let a = NotifLocationType::CreateComment;
        let res = serde_json::json!({
            r#"type"#: a,
        })
        .to_string();
        assert_eq!(res, r#"{"type":"create-comment"}"#);
        Ok(())
    }
}
