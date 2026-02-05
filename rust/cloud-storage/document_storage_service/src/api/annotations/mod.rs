pub mod create_anchor;
pub mod create_comment;
pub mod delete_anchor;
pub mod delete_comment;
pub mod edit_anchor;
pub mod edit_comment;
pub mod get;

use std::{collections::HashSet, fmt::Display};

use super::context::ApiContext;
use axum::{
    Json, Router,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
};
use macro_db_client::annotations::CommentError;
use macro_user_id::email::ReadEmailParts;
use macro_user_id::user_id::MacroUserIdStr;
use model::{annotations::Comment, response::ErrorResponse};
use model_entity::Entity;
use model_entity::EntityType;
use notification::domain::models::{
    NotifCollapseKey, Notification, NotificationExtIos, RateLimitConfig, RateLimitKey,
    SendNotificationRequestBuilder,
    apple::{APNSPushNotification, AlertDictionary, Aps},
};
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, Deserialize, ToSchema)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::api) struct Location {
    r#type: NotifLocationType,
    comment_id: Option<i64>,
    thread_id: i64,
    text: String,
}

/// Notification sent when a user is mentioned in a document comment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMentionNotification {
    /// The name of the document.
    pub document_name: String,
    /// The owner of the document.
    pub owner: MacroUserIdStr<'static>,
    /// The file type of the document.
    pub file_type: Option<String>,
    /// The mention ID.
    pub mention_id: String,
    /// The location metadata for the mention.
    pub location: Location,
}

impl Notification for DocumentMentionNotification {
    const TYPE_NAME: &'static str = "document_mention";

    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
    }
}

impl NotificationExtIos for DocumentMentionNotification {
    type NotifData = ();

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn into_apns<'a>(
        self,
        sender_id: Option<MacroUserIdStr<'a>>,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let sender = sender_id?;
        let file_type = self.file_type.as_ref()?;
        let title = sender.0.email_part().email_str().to_string();
        let body = format!("You were mentioned in {}.{}", self.document_name, file_type);
        Some(APNSPushNotification {
            aps: Aps {
                alert: Some(notification::domain::models::apple::Alert::Dictionary(
                    AlertDictionary {
                        title: Some(title),
                        body: Some(body),
                        ..Default::default()
                    },
                )),
                ..Default::default()
            },
            push_notification_data: (),
        })
    }
}

#[expect(clippy::too_many_arguments)]
fn build_mention_notif<'a>(
    notif_location_type: NotifLocationType,
    text: String,
    comment: Option<&Comment>,
    thread_id: i64,
    mentions: &'a [String],
    document_name: String,
    owner: MacroUserIdStr<'static>,
    file_type: Option<String>,
    sender_id: Option<MacroUserIdStr<'static>>,
    document_id: String,
    mention_id: &str,
) -> SendNotificationRequestBuilder<'a, DocumentMentionNotification> {
    let notification = DocumentMentionNotification {
        document_name,
        owner,
        file_type,
        mention_id: mention_id.to_string(),
        location: Location {
            r#type: notif_location_type,
            comment_id: comment.map(|c| c.comment_id),
            thread_id,
            text,
        },
    };

    let recipient_ids: HashSet<MacroUserIdStr<'a>> = mentions
        .iter()
        .filter_map(|id| MacroUserIdStr::parse_from_str(id).ok())
        .collect();

    SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_string(document_id),
        notification,
        sender_id,
        recipient_ids,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_ser_notif_type() -> Result<(), Box<dyn std::error::Error>> {
        let a = NotifLocationType::CreateComment;
        let res = serde_json::json!({
            r#"type"#: a,
        })
        .to_string();
        assert_eq!(res, r#"{"type":"create-comment"}"#);
        Ok(())
    }
    #[test]
    fn check_ser_meta() -> Result<(), Box<dyn std::error::Error>> {
        let m = DocumentMentionNotification {
            document_name: "test".to_string(),
            owner: MacroUserIdStr::parse_from_str("macro|user@test.com").unwrap(),
            file_type: None,
            mention_id: "xxx".to_string(),
            location: Location {
                r#type: NotifLocationType::EditComment,
                thread_id: 42,
                comment_id: Some(99),
                text: "yy".to_string(),
            },
        };
        let res = serde_json::to_string(&m).unwrap();
        assert!(res.contains(r#"mentionId":"xxx""#));
        assert!(res.contains(r#"threadId":42"#));
        assert!(res.contains(r#"commentId":99"#));
        assert!(res.contains(r#""type":"edit-comment""#));
        Ok(())
    }
}
