//! Start a comment thread anchored to a quoted passage of a markdown or Word
//! document: the CommentOnText tool and `POST /documents/{id}/comments/text`.

use entity_access::domain::models::{EntityAccessAuth, EntityAccessReceipt, EntityType};
use macro_sync_service_jwt::DocumentPermissionToken;
use messages::domain::{
    api::MessageCommands,
    models::{
        Message, MessageAttribution, NewThreadAnchor, PostMessage, PostMessageNotificationPolicy,
        SimpleMention,
    },
    ports::MessageError,
    service::MessageWrite,
};
use model::document::{DocumentBasic, FileType};
use models_permissions::share_permission::access_level::AccessLevel;
use uuid::Uuid;

use super::models::DocumentError;
use super::permission_token::encode_permission_token;
use super::ports::editing::{CommentMarkPlacement, EditingWorkerService};

#[cfg(test)]
mod test;

/// A comment on a quoted passage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextCommentRequest<'a> {
    /// Comment body in macro markdown.
    pub content: &'a str,
    /// The people and items the body mentions, notified as in any comment.
    pub mentions: Vec<SimpleMention>,
    /// The passage, quoted as the document reads, as plain text.
    pub quote: &'a str,
    /// Which appearance of the passage, counting from 1; `None` when it
    /// appears once.
    pub occurrence: Option<u32>,
}

/// The thread a comment on text started.
#[derive(Debug, Clone)]
pub struct TextComment {
    /// The posted comment, the root of its thread.
    pub message: Message,
    /// The text the comment is anchored to, as the document reads.
    pub marked_text: String,
}

/// Why a comment on text was not posted. Nothing is left behind in any case.
#[derive(Debug, thiserror::Error)]
pub enum TextCommentError {
    /// The request cannot be met as asked; the message says what to change.
    #[error("{0}")]
    Invalid(String),
    /// The quote is ambiguous or not in the document; the reason lists the
    /// appearances to choose from, or says it was not found.
    #[error("{0}")]
    Refused(String),
    /// The receipt is not for this document, or the token could not be minted.
    #[error(transparent)]
    Document(#[from] DocumentError),
    /// The editing worker could not place the mark.
    #[error("unable to anchor the comment to the text: {0}")]
    Anchor(anyhow::Error),
    /// The message service refused or failed the post.
    #[error(transparent)]
    Message(#[from] MessageError),
}

/// Anchor a new comment thread to `request.quote` in `document`, posting as
/// `access`'s principal. On a markdown document the mark goes in first and is
/// taken out again if the thread cannot be posted, so a refusal leaves the
/// document untouched; a Word document's editor places the thread by its
/// quote, so it only posts.
#[tracing::instrument(
    skip_all,
    fields(document_id = %document.document_id, quote_len = request.quote.len(), occurrence = ?request.occurrence),
    err
)]
pub async fn comment_on_text<Worker, Messages>(
    editing: &Worker,
    messages: &Messages,
    jwt_secret: &str,
    access: EntityAccessReceipt<MessageWrite>,
    document: &DocumentBasic,
    attribution: MessageAttribution,
    request: TextCommentRequest<'_>,
) -> Result<TextComment, TextCommentError>
where
    Worker: EditingWorkerService,
    Messages: MessageCommands + ?Sized,
{
    if access.entity().entity_type != EntityType::Document
        || access.entity().entity_id != document.document_id
    {
        return Err(DocumentError::Unauthorized.into());
    }
    if request.occurrence == Some(0) {
        return Err(TextCommentError::Invalid(
            "occurrence counts from 1: pass 1 for the first appearance of the text".to_string(),
        ));
    }
    match document.try_file_type() {
        Some(FileType::Md) => {
            comment_on_markdown(
                editing,
                messages,
                jwt_secret,
                access,
                document,
                attribution,
                request,
            )
            .await
        }
        Some(FileType::Docx) => comment_on_docx(messages, access, attribution, request).await,
        _ => Err(TextCommentError::Invalid(
            "inline comments anchor to text in Macro markdown and Word documents only; use Comment to comment on this document as a whole".to_string(),
        )),
    }
}

async fn comment_on_markdown<Worker, Messages>(
    editing: &Worker,
    messages: &Messages,
    jwt_secret: &str,
    access: EntityAccessReceipt<MessageWrite>,
    document: &DocumentBasic,
    attribution: MessageAttribution,
    request: TextCommentRequest<'_>,
) -> Result<TextComment, TextCommentError>
where
    Worker: EditingWorkerService,
    Messages: MessageCommands + ?Sized,
{
    let document_id = document.document_id.as_str();
    let document_token = comment_token(&access, document_id, jwt_secret)?;

    // The mark goes in first: refusing an ambiguous or missing passage is
    // the likely failure, and it then leaves nothing behind, where a thread
    // posted first would already have notified people of a comment that
    // cannot be placed.
    let mark_id = Uuid::now_v7();
    let placement = match editing
        .add_comment_mark(
            document_id,
            &document_token,
            mark_id,
            request.quote,
            request.occurrence,
        )
        .await
    {
        Ok(placement) => placement,
        Err(error) => {
            // The worker may have pushed the mark before the failure reached
            // us, as when the sync service never acknowledged it.
            remove_mark(editing, document_id, &document_token, mark_id).await;
            return Err(TextCommentError::Anchor(error));
        }
    };
    let marked_text = match placement {
        CommentMarkPlacement::Placed { marked_text } => marked_text,
        CommentMarkPlacement::Refused(reason) => return Err(TextCommentError::Refused(reason)),
    };

    let posted = messages
        .post(
            access,
            new_thread(request, attribution, mark_id, &marked_text),
        )
        .await;
    match posted {
        Ok(message) => Ok(TextComment {
            message,
            marked_text,
        }),
        Err(error) => {
            remove_mark(editing, document_id, &document_token, mark_id).await;
            Err(error.into())
        }
    }
}

/// A Word document keeps its comment marks beside its collaborative blocks,
/// where the editor places a thread by the text it quotes and pins it with a
/// mark. The thread is posted with that quote and a fresh mark id; a quote the
/// editor cannot find shows with the comments on changed text.
async fn comment_on_docx<Messages>(
    messages: &Messages,
    access: EntityAccessReceipt<MessageWrite>,
    attribution: MessageAttribution,
    request: TextCommentRequest<'_>,
) -> Result<TextComment, TextCommentError>
where
    Messages: MessageCommands + ?Sized,
{
    if request.occurrence.is_some_and(|occurrence| occurrence > 1) {
        return Err(TextCommentError::Invalid(
            "comments on a Word document attach to the first appearance of the quoted text; quote a longer passage that appears only once".to_string(),
        ));
    }
    let marked_text = request.quote.trim();
    if marked_text.is_empty() {
        return Err(TextCommentError::Invalid(
            "quote the passage to comment on".to_string(),
        ));
    }
    let message = messages
        .post(
            access,
            new_thread(request, attribution, Uuid::now_v7(), marked_text),
        )
        .await?;
    Ok(TextComment {
        message,
        marked_text: marked_text.to_owned(),
    })
}

fn new_thread(
    request: TextCommentRequest<'_>,
    attribution: MessageAttribution,
    mark_id: Uuid,
    marked_text: &str,
) -> PostMessage {
    PostMessage {
        id: None,
        attribution,
        notification_policy: PostMessageNotificationPolicy::Default,
        content: request.content.to_owned(),
        thread_id: None,
        anchor: Some(NewThreadAnchor::Markdown {
            mark_id,
            marked_text: Some(marked_text.to_owned()),
        }),
        mentions: request.mentions,
        attachments: vec![],
        nonce: None,
    }
}

/// The worker token for placing the mark, naming the receipt's user and bot.
/// Placing it is a content change, but the one a commenter makes whenever they
/// comment on a selection, so comment access suffices, as it does for the web
/// composer and the sync service.
fn comment_token(
    access: &EntityAccessReceipt<MessageWrite>,
    document_id: &str,
    jwt_secret: &str,
) -> Result<DocumentPermissionToken, DocumentError> {
    let bot = match access.auth() {
        EntityAccessAuth::Bot(bot) => Some(bot.bot_id()),
        EntityAccessAuth::Authenticated(_)
        | EntityAccessAuth::Unauthenticated
        | EntityAccessAuth::Internal => None,
    };
    let user = access.acting_user_id();
    if user.is_none() && bot.is_none() {
        return Err(DocumentError::Unauthorized);
    }
    encode_permission_token(
        user.map(ToString::to_string),
        document_id.to_owned(),
        AccessLevel::Comment,
        jwt_secret,
        bot.map(|bot| bot.into_storage_id().to_string()),
    )
}

/// Best-effort removal of a mark whose thread was never posted: left in place
/// it would highlight text nobody commented on.
async fn remove_mark<Worker: EditingWorkerService>(
    editing: &Worker,
    document_id: &str,
    document_token: &DocumentPermissionToken,
    mark_id: Uuid,
) {
    if let Err(error) = editing
        .remove_comment_mark(document_id, document_token, mark_id)
        .await
    {
        tracing::error!(error = ?error, %mark_id, "comment mark left without its thread");
    }
}
