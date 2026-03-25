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
use model::{annotations::Comment, response::ErrorResponse};
use model_entity::EntityType;
use model_notifications::{
    CommentedOnDocumentMetadata, MentionedInDocumentCommentMetadata,
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

/// Computes the recipient sets for each notification type, ensuring no user
/// receives more than one notification per comment.
///
/// Priority: mention > thread reply > document owner.
pub(crate) fn compute_notification_recipients(
    sender_id: Option<&MacroUserIdStr<'_>>,
    mentioned_user_ids: &[String],
    thread_comment_owners: &[String],
    document_owner: &MacroUserIdStr<'_>,
    is_reply: bool,
) -> NotificationRecipients {
    let mut notified: HashSet<String> = HashSet::new();

    // 1. Mention recipients — normalize to MacroUserIdStr format for consistent comparison
    let mention_recipients: Vec<String> = mentioned_user_ids
        .iter()
        .filter_map(|id| {
            MacroUserIdStr::parse_from_str(id)
                .ok()
                .map(|parsed| parsed.as_ref().to_string())
        })
        .collect();
    notified.extend(mention_recipients.iter().cloned());

    // 2. Thread reply recipients — only if this is a reply (>1 comments in thread)
    let mut thread_reply_recipients: Vec<String> = Vec::new();
    if is_reply {
        for owner_str in thread_comment_owners {
            if let Ok(parsed) = MacroUserIdStr::parse_from_str(owner_str) {
                let normalized = parsed.as_ref().to_string();
                let is_sender = sender_id.map_or(false, |s| s.as_ref() == normalized);
                if !is_sender && !notified.contains(&normalized) {
                    notified.insert(normalized.clone());
                    thread_reply_recipients.push(normalized);
                }
            }
        }
    }

    // 3. Document owner — only if not sender and not already notified
    let owner_normalized = document_owner.as_ref().to_string();
    let owner_is_sender = sender_id.map_or(false, |s| s.as_ref() == owner_normalized);
    let doc_owner_recipient = if !owner_is_sender && !notified.contains(&owner_normalized) {
        Some(owner_normalized)
    } else {
        None
    };

    NotificationRecipients {
        mention_recipients,
        thread_reply_recipients,
        doc_owner_recipient,
    }
}

pub(crate) struct NotificationRecipients {
    /// Users who should get a mention notification.
    pub mention_recipients: Vec<String>,
    /// Users who should get a thread reply notification.
    pub thread_reply_recipients: Vec<String>,
    /// The document owner, if they should get a "commented on your document" notification.
    pub doc_owner_recipient: Option<String>,
}

impl NotificationRecipients {
    /// Returns all recipient IDs across all notification types.
    #[cfg(test)]
    pub fn all_recipients(&self) -> HashSet<&str> {
        let mut all = HashSet::new();
        for r in &self.mention_recipients {
            all.insert(r.as_str());
        }
        for r in &self.thread_reply_recipients {
            all.insert(r.as_str());
        }
        if let Some(r) = &self.doc_owner_recipient {
            all.insert(r.as_str());
        }
        all
    }

    /// Total number of recipients across all notification types.
    #[cfg(test)]
    pub fn total_count(&self) -> usize {
        self.mention_recipients.len()
            + self.thread_reply_recipients.len()
            + self.doc_owner_recipient.iter().count()
    }
}

#[expect(clippy::too_many_arguments)]
fn build_mention_notif<'a>(
    text: String,
    comment: &Comment,
    thread_id: i64,
    mentions: &'a [String],
    document_name: String,
    owner: MacroUserIdStr<'static>,
    file_type: Option<String>,
    sender_id: Option<MacroUserIdStr<'static>>,
    document_id: String,
    mention_id: &str,
    sender_profile_picture_url: Option<String>,
) -> SendNotificationRequestBuilder<'a, MentionedInDocumentCommentMetadata> {
    let notification = MentionedInDocumentCommentMetadata {
        document_name,
        owner,
        file_type,
        mention_id: mention_id.to_string(),
        comment_id: comment.comment_id,
        thread_id,
        text,
        sender_profile_picture_url,
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

fn build_thread_reply_notif<'a>(
    text: String,
    comment: &Comment,
    thread_id: i64,
    participant_ids: HashSet<MacroUserIdStr<'a>>,
    document_name: String,
    owner: MacroUserIdStr<'static>,
    file_type: Option<String>,
    sender_id: Option<MacroUserIdStr<'static>>,
    document_id: String,
    sender_profile_picture_url: Option<String>,
) -> SendNotificationRequestBuilder<'a, RepliedToDocumentCommentThreadMetadata> {
    let notification = RepliedToDocumentCommentThreadMetadata {
        document_name,
        owner,
        file_type,
        comment_id: comment.comment_id,
        thread_id,
        text,
        sender_profile_picture_url,
    };

    SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_string(document_id),
        notification,
        sender_id,
        recipient_ids: participant_ids,
    }
}

fn build_document_comment_notif(
    text: String,
    comment: &Comment,
    thread_id: i64,
    document_owner: MacroUserIdStr<'static>,
    document_name: String,
    file_type: Option<String>,
    sender_id: Option<MacroUserIdStr<'static>>,
    document_id: String,
    sender_profile_picture_url: Option<String>,
) -> SendNotificationRequestBuilder<'static, CommentedOnDocumentMetadata> {
    let notification = CommentedOnDocumentMetadata {
        document_name,
        owner: document_owner.clone(),
        file_type,
        comment_id: comment.comment_id,
        thread_id,
        text,
        sender_profile_picture_url,
    };

    let mut recipient_ids = HashSet::new();
    recipient_ids.insert(document_owner);

    SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_string(document_id),
        notification,
        sender_id,
        recipient_ids,
    }
}

#[cfg(test)]
mod test;
