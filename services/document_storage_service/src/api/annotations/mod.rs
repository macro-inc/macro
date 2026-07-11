pub mod create_anchor;
pub mod create_comment;
pub mod delete_anchor;
pub mod delete_comment;
pub mod edit_anchor;
pub mod edit_comment;
pub mod get;

use std::collections::HashSet;

use super::context::ApiContext;
use axum::{
    Json, Router,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
};
use macro_db_client::annotations::CommentError;
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use model_entity::EntityType;
use model_notifications::{
    CommentedOnDocumentMetadata, MentionedInDocumentCommentMetadata, NotificationDocumentSubType,
    RepliedToDocumentCommentThreadMetadata,
};
use notification::domain::models::SendNotificationRequestBuilder;
use tower::ServiceBuilder;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route(
            "/comments/document/{document_id}",
            get(get::get_document_comments_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    macro_middleware::cloud_storage::document::ensure_document_exists::handler,
                ),
            )),
        )
        .route(
            "/comments/document/{document_id}",
            post(create_comment::create_comment_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    macro_middleware::cloud_storage::document::ensure_document_exists::handler,
                ),
            )),
        )
        .route(
            "/comments/comment/{comment_id}",
            delete(delete_comment::delete_comment_handler),
        )
        .route("/anchors", delete(delete_anchor::delete_anchor_handler))
        .route("/anchors", patch(edit_anchor::edit_anchor_handler))
        .route(
            "/comments/comment/{comment_id}",
            patch(edit_comment::edit_comment_handler),
        )
        .route(
            "/anchors/document/{document_id}",
            get(get::get_document_anchors_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    macro_middleware::cloud_storage::document::ensure_document_exists::handler,
                ),
            )),
        )
        .route(
            "/anchors/document/{document_id}",
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
                message: e.to_string().into(),
            }),
        )
            .into_response()),
        Some(CommentError::ThreadNotFound) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: e.to_string().into(),
            }),
        )
            .into_response()),
        Some(CommentError::AnchorNotFound) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: e.to_string().into(),
            }),
        )
            .into_response()),
        Some(CommentError::InvalidPermissions) => Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                message: e.to_string().into(),
            }),
        )
            .into_response()),
        Some(CommentError::NotAllowed(msg)) => Err((
            StatusCode::METHOD_NOT_ALLOWED,
            Json(ErrorResponse {
                message: msg.into(),
            }),
        )
            .into_response()),
        None => {
            tracing::error!(error = ?e, "unknown error occurred");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: default_msg.into(),
                }),
            )
                .into_response())
        }
    }
}

/// Computes the recipient sets for each notification type, ensuring no user
/// receives more than one notification per comment.
///
/// Priority: mention > thread reply > task assignee > document owner.
pub(crate) fn compute_notification_recipients(
    sender_id: Option<&MacroUserIdStr<'_>>,
    mentioned_user_ids: &[String],
    thread_participant_ids: &[String],
    task_assignee_ids: &[String],
    document_owner: &MacroUserIdStr<'_>,
    is_reply: bool,
) -> NotificationRecipients {
    let mut notified: HashSet<String> = HashSet::new();

    // 1. Mention recipients — normalize to MacroUserIdStr format for consistent comparison
    let mention_recipients: HashSet<MacroUserIdStr<'static>> = mentioned_user_ids
        .iter()
        .filter_map(|id| MacroUserIdStr::try_from(id.clone()).ok())
        .collect();
    notified.extend(mention_recipients.iter().map(|id| id.as_ref().to_string()));

    // 2. Thread reply recipients — only if this is a reply (>1 comments in thread).
    // Any user who has commented on the thread is a participant and should receive
    // subsequent reply notifications, even when they are not the document owner or
    // a task assignee.
    let mut thread_reply_recipients: HashSet<MacroUserIdStr<'static>> = HashSet::new();
    if is_reply {
        for participant_str in thread_participant_ids {
            if let Ok(parsed) = MacroUserIdStr::try_from(participant_str.clone()) {
                let normalized = parsed.as_ref().to_string();
                let is_sender = sender_id.is_some_and(|s| s.as_ref() == normalized);
                if !is_sender && !notified.contains(&normalized) {
                    notified.insert(normalized);
                    thread_reply_recipients.insert(parsed);
                }
            }
        }
    }

    // 3. Task assignee recipients — only if not sender and not already notified
    let mut assignee_recipients: HashSet<MacroUserIdStr<'static>> = HashSet::new();
    for assignee_str in task_assignee_ids {
        if let Ok(parsed) = MacroUserIdStr::try_from(assignee_str.clone()) {
            let normalized = parsed.as_ref().to_string();
            let is_sender = sender_id.is_some_and(|s| s.as_ref() == normalized);
            if !is_sender && !notified.contains(&normalized) {
                notified.insert(normalized);
                assignee_recipients.insert(parsed);
            }
        }
    }

    // 4. Document owner — only if not sender and not already notified
    let owner_normalized = document_owner.as_ref().to_string();
    let owner_is_sender = sender_id.is_some_and(|s| s.as_ref() == owner_normalized);
    let doc_owner_recipient = if !owner_is_sender && !notified.contains(&owner_normalized) {
        Some(owner_normalized)
    } else {
        None
    };

    NotificationRecipients {
        mention_recipients,
        thread_reply_recipients,
        assignee_recipients,
        doc_owner_recipient,
    }
}

pub(crate) struct NotificationRecipients {
    /// Users who should get a mention notification (already parsed and owned).
    pub mention_recipients: HashSet<MacroUserIdStr<'static>>,
    /// Users who should get a thread reply notification (already parsed and owned).
    pub thread_reply_recipients: HashSet<MacroUserIdStr<'static>>,
    /// Task assignees who should get a "commented on your task" notification.
    pub assignee_recipients: HashSet<MacroUserIdStr<'static>>,
    /// The document owner, if they should get a "commented on your document" notification.
    pub doc_owner_recipient: Option<String>,
}

impl NotificationRecipients {
    /// Returns all recipient IDs across all notification types.
    #[cfg(test)]
    pub fn all_recipients(&self) -> HashSet<String> {
        let mut all = HashSet::new();
        for r in &self.mention_recipients {
            all.insert(r.as_ref().to_string());
        }
        for r in &self.thread_reply_recipients {
            all.insert(r.as_ref().to_string());
        }
        for r in &self.assignee_recipients {
            all.insert(r.as_ref().to_string());
        }
        if let Some(r) = &self.doc_owner_recipient {
            all.insert(r.clone());
        }
        all
    }

    /// Total number of recipients across all notification types.
    #[cfg(test)]
    pub fn total_count(&self) -> usize {
        self.mention_recipients.len()
            + self.thread_reply_recipients.len()
            + self.assignee_recipients.len()
            + self.doc_owner_recipient.iter().count()
    }
}

pub(crate) struct CommentNotifContext {
    pub text: String,
    pub comment_id: i64,
    pub thread_id: i64,
    pub document_name: String,
    pub document_id: String,
    pub owner: MacroUserIdStr<'static>,
    pub file_type: Option<String>,
    pub sub_type: Option<NotificationDocumentSubType>,
    pub sender_id: Option<MacroUserIdStr<'static>>,
    pub sender_profile_picture_url: Option<String>,
}

impl CommentNotifContext {
    pub fn build_mention_notif(
        &self,
        recipient_ids: HashSet<MacroUserIdStr<'static>>,
        mention_id: &str,
    ) -> SendNotificationRequestBuilder<'static, MentionedInDocumentCommentMetadata> {
        let notification = MentionedInDocumentCommentMetadata {
            document_name: self.document_name.clone(),
            owner: self.owner.clone(),
            file_type: self.file_type.clone(),
            sub_type: self.sub_type.clone(),
            mention_id: mention_id.to_string(),
            comment_id: self.comment_id,
            thread_id: self.thread_id,
            text: self.text.clone(),
            sender_profile_picture_url: self.sender_profile_picture_url.clone(),
        };

        SendNotificationRequestBuilder {
            notification_entity: EntityType::Document.with_entity_string(self.document_id.clone()),
            secondary_notification_entity: None,
            notification,
            sender_id: self.sender_id.clone(),
            recipient_ids,
        }
    }

    pub fn build_thread_reply_notif(
        &self,
        participant_ids: HashSet<MacroUserIdStr<'static>>,
    ) -> SendNotificationRequestBuilder<'static, RepliedToDocumentCommentThreadMetadata> {
        let notification = RepliedToDocumentCommentThreadMetadata {
            document_name: self.document_name.clone(),
            owner: self.owner.clone(),
            file_type: self.file_type.clone(),
            sub_type: self.sub_type.clone(),
            comment_id: self.comment_id,
            thread_id: self.thread_id,
            text: self.text.clone(),
            sender_profile_picture_url: self.sender_profile_picture_url.clone(),
        };

        SendNotificationRequestBuilder {
            notification_entity: EntityType::Document.with_entity_string(self.document_id.clone()),
            secondary_notification_entity: None,
            notification,
            sender_id: self.sender_id.clone(),
            recipient_ids: participant_ids,
        }
    }

    fn commented_on_document_metadata(&self) -> CommentedOnDocumentMetadata {
        CommentedOnDocumentMetadata {
            document_name: self.document_name.clone(),
            owner: self.owner.clone(),
            file_type: self.file_type.clone(),
            sub_type: self.sub_type.clone(),
            comment_id: self.comment_id,
            thread_id: self.thread_id,
            text: self.text.clone(),
            sender_profile_picture_url: self.sender_profile_picture_url.clone(),
        }
    }

    pub fn build_task_assignee_comment_notif(
        &self,
        assignee_ids: HashSet<MacroUserIdStr<'static>>,
    ) -> SendNotificationRequestBuilder<'static, CommentedOnDocumentMetadata> {
        SendNotificationRequestBuilder {
            notification_entity: EntityType::Document.with_entity_string(self.document_id.clone()),
            secondary_notification_entity: None,
            notification: self.commented_on_document_metadata(),
            sender_id: self.sender_id.clone(),
            recipient_ids: assignee_ids,
        }
    }

    pub fn build_document_comment_notif(
        &self,
    ) -> SendNotificationRequestBuilder<'static, CommentedOnDocumentMetadata> {
        let mut recipient_ids = HashSet::new();
        recipient_ids.insert(self.owner.clone());

        SendNotificationRequestBuilder {
            notification_entity: EntityType::Document.with_entity_string(self.document_id.clone()),
            secondary_notification_entity: None,
            notification: self.commented_on_document_metadata(),
            sender_id: self.sender_id.clone(),
            recipient_ids,
        }
    }
}

#[cfg(test)]
mod test;
