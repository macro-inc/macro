//! A document's comments as an agent reads them: inline threads with what they
//! are anchored to, and Discussion threads on the document as a whole.

#[cfg(test)]
mod test;

use std::{collections::HashMap, sync::Arc};

use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use futures::{StreamExt, TryStreamExt, stream};
use messages::domain::{
    api::MessageReader,
    models::{Message, MessageListItem, ThreadAnchor},
    ports::{MessageError, MessageTimelineQuery},
    service::MessageView,
};
use uuid::Uuid;

use super::models::DocumentError;

/// Discussions read per timeline page, the most the message service returns.
const PAGE_SIZE: u16 = 100;

/// Most discussions returned for one document, newest kept, so a heavily
/// discussed document cannot crowd its own content out of an agent's context.
pub const MAX_DISCUSSIONS: usize = 500;

/// Concurrent thread and mark lookups for one read.
const LOOKUP_CONCURRENCY: usize = 8;

/// Reads what a comment mark covers in the live document.
#[async_trait::async_trait]
pub trait CommentMarks: Send + Sync + 'static {
    /// The text the mark covers now, `None` when the document no longer
    /// carries it. Checks no access of its own: it is only asked after the
    /// discussions were read under the caller's capability on the document.
    async fn marked_text(&self, document_id: &str, mark_id: Uuid)
    -> anyhow::Result<Option<String>>;
}

/// Where a discussion sits in its document.
#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CommentAnchor {
    /// A Discussion comment on the document as a whole.
    Document,
    /// An inline comment on a passage of a markdown document.
    #[serde(rename_all = "camelCase")]
    Text {
        /// The comment mark in the document.
        mark_id: Uuid,
        /// The text the comment is on, as the document reads now; the text
        /// when the comment was written if the document could not be read.
        #[serde(skip_serializing_if = "Option::is_none")]
        marked_text: Option<String>,
        /// The text when the comment was written, when it differs from now.
        #[serde(skip_serializing_if = "Option::is_none")]
        original_marked_text: Option<String>,
        /// The commented text has since been removed from the document.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        removed: bool,
    },
    /// A comment on a PDF highlight.
    #[serde(rename_all = "camelCase")]
    PdfHighlight {
        /// The highlight annotation.
        anchor_id: Uuid,
    },
    /// A comment pinned to a point on a PDF page.
    #[serde(rename_all = "camelCase")]
    PdfPin {
        /// The pin annotation.
        anchor_id: Uuid,
    },
}

/// A single comment in a discussion.
#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentComment {
    /// The comment id.
    pub id: Uuid,
    /// The user or bot id of the author.
    pub author: String,
    /// The author's display name, for bots and comments imported from other documents.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_name: Option<String>,
    /// The comment body in markdown; absent when the comment was deleted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// When the comment was written.
    pub created_at: DateTime<Utc>,
    /// When the comment was last edited.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edited_at: Option<DateTime<Utc>>,
}

/// Whether a thread is on part of a document or on the document as a whole.
#[derive(serde::Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum CommentThreadKind {
    /// An inline comment on a passage, PDF highlight or PDF pin.
    Inline,
    /// A comment in the document's Discussion panel.
    Discussion,
}

/// A comment thread on a document: its first comment followed by the replies.
#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentDiscussion {
    /// The thread id, which is the id of its first comment. Replies and
    /// resolution address the thread by this id.
    pub id: Uuid,
    /// Whether the thread is inline or a Discussion comment.
    pub kind: CommentThreadKind,
    /// Whether the thread has been resolved.
    pub resolved: bool,
    /// What the thread is attached to.
    pub anchor: CommentAnchor,
    /// The comments in order, first comment first.
    pub comments: Vec<DocumentComment>,
}

/// Reads a document's comments.
#[async_trait::async_trait]
pub trait DocumentComments: Send + Sync + 'static {
    /// Every live discussion on the document, oldest first, capped at
    /// [`MAX_DISCUSSIONS`].
    async fn discussions(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<DocumentDiscussion>, DocumentError>;
}

/// [`DocumentComments`] over the shared message service.
pub struct DocumentCommentReader<M> {
    messages: Arc<dyn MessageReader>,
    marks: M,
}

impl<M: CommentMarks> DocumentCommentReader<M> {
    /// Read discussions from `messages`, resolving inline anchors with `marks`.
    pub fn new(messages: Arc<dyn MessageReader>, marks: M) -> Self {
        Self { messages, marks }
    }

    async fn roots(
        &self,
        access: &EntityAccessReceipt<MessageView>,
    ) -> Result<Vec<MessageListItem>, MessageError> {
        let mut roots = Vec::new();
        let mut cursor = None;
        loop {
            let page = self
                .messages
                .timeline(
                    access.clone(),
                    MessageTimelineQuery {
                        cursor,
                        limit: Some(PAGE_SIZE),
                        ..Default::default()
                    },
                )
                .await?;
            // A deleted first comment with no live replies is not returned,
            // so it must not count toward the cap.
            roots.extend(
                page.items.into_iter().filter(|item| {
                    item.message.deleted_at.is_none() || item.thread.reply_count > 0
                }),
            );
            if roots.len() >= MAX_DISCUSSIONS {
                tracing::warn!(count = roots.len(), "document discussions truncated");
                roots.truncate(MAX_DISCUSSIONS);
                return Ok(roots);
            }
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => return Ok(roots),
            }
        }
    }

    /// Replies of the threads whose timeline preview does not hold them all.
    async fn full_replies(
        &self,
        access: &EntityAccessReceipt<MessageView>,
        roots: &[MessageListItem],
    ) -> Result<HashMap<Uuid, Vec<Message>>, MessageError> {
        let partial: Vec<Uuid> = roots
            .iter()
            .filter(|item| item.thread.reply_count > item.thread.preview.len() as i64)
            .map(|item| item.message.id)
            .collect();
        stream::iter(partial)
            .map(|root| async move {
                let thread = self.messages.get_thread(access.clone(), root).await?;
                Ok::<_, MessageError>((root, thread.replies))
            })
            .buffer_unordered(LOOKUP_CONCURRENCY)
            .try_collect()
            .await
    }

    /// What each markdown mark covers now. A failed lookup leaves the mark
    /// out, so the snapshot stands in rather than failing the read.
    async fn live_marks(
        &self,
        document_id: &str,
        roots: &[MessageListItem],
    ) -> HashMap<Uuid, Option<String>> {
        let mark_ids: Vec<Uuid> = roots
            .iter()
            .filter_map(|item| match &item.state.anchor {
                Some(ThreadAnchor::Markdown { mark_id, .. }) => Some(*mark_id),
                _ => None,
            })
            .collect();
        stream::iter(mark_ids)
        .map(|mark_id| async move {
            self.marks
                .marked_text(document_id, mark_id)
                .await
                .inspect_err(|error| {
                    tracing::warn!(error = ?error, %mark_id, "reading comment without the live marked text");
                })
                .ok()
                .map(|text| (mark_id, text))
        })
        .buffer_unordered(LOOKUP_CONCURRENCY)
        .filter_map(std::future::ready)
        .collect()
        .await
    }
}

#[async_trait::async_trait]
impl<M: CommentMarks> DocumentComments for DocumentCommentReader<M> {
    #[tracing::instrument(err, skip_all, fields(document_id = %receipt.entity().entity_id))]
    async fn discussions(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<DocumentDiscussion>, DocumentError> {
        let document_id = receipt.entity().entity_id.clone();
        let access = receipt
            .try_into_requirement::<MessageView>()
            .map_err(|_| DocumentError::Unauthorized)?;
        let roots = self.roots(&access).await.map_err(message_error)?;
        let (replies, marks) = futures::join!(
            self.full_replies(&access, &roots),
            self.live_marks(&document_id, &roots)
        );
        let mut replies = replies.map_err(message_error)?;
        Ok(roots
            .into_iter()
            .rev()
            .filter_map(|item| {
                let replies = replies
                    .remove(&item.message.id)
                    .unwrap_or(item.thread.preview);
                discussion(
                    item.message,
                    item.state.resolved,
                    item.state.anchor,
                    replies,
                    &marks,
                )
            })
            .collect())
    }
}

/// A thread whose first comment was deleted is kept only while it has replies.
fn discussion(
    root: Message,
    resolved: bool,
    anchor: Option<ThreadAnchor>,
    replies: Vec<Message>,
    marks: &HashMap<Uuid, Option<String>>,
) -> Option<DocumentDiscussion> {
    if root.deleted_at.is_some() && replies.is_empty() {
        return None;
    }
    let kind = match anchor {
        None => CommentThreadKind::Discussion,
        Some(_) => CommentThreadKind::Inline,
    };
    Some(DocumentDiscussion {
        id: root.id,
        kind,
        resolved,
        anchor: comment_anchor(anchor, marks),
        comments: std::iter::once(root)
            .chain(
                replies
                    .into_iter()
                    .filter(|reply| reply.deleted_at.is_none()),
            )
            .map(comment)
            .collect(),
    })
}

fn comment_anchor(
    anchor: Option<ThreadAnchor>,
    marks: &HashMap<Uuid, Option<String>>,
) -> CommentAnchor {
    match anchor {
        None => CommentAnchor::Document,
        Some(ThreadAnchor::Markdown {
            mark_id,
            marked_text: snapshot,
        }) => match marks.get(&mark_id) {
            Some(Some(current)) => CommentAnchor::Text {
                mark_id,
                original_marked_text: snapshot.filter(|snapshot| snapshot != current),
                marked_text: Some(current.clone()),
                removed: false,
            },
            Some(None) => CommentAnchor::Text {
                mark_id,
                marked_text: snapshot,
                original_marked_text: None,
                removed: true,
            },
            None => CommentAnchor::Text {
                mark_id,
                marked_text: snapshot,
                original_marked_text: None,
                removed: false,
            },
        },
        Some(ThreadAnchor::PdfHighlight { anchor_id }) => CommentAnchor::PdfHighlight { anchor_id },
        Some(ThreadAnchor::PdfPlaceable { anchor_id }) => CommentAnchor::PdfPin { anchor_id },
    }
}

fn comment(message: Message) -> DocumentComment {
    let deleted = message.deleted_at.is_some();
    DocumentComment {
        id: message.id,
        author: message.sender_id.as_ref().to_owned(),
        author_name: message
            .imported_author
            .map(|author| author.name)
            .or(message.bot_profile.map(|bot| bot.name)),
        content: (!deleted).then_some(message.content),
        created_at: message.created_at,
        edited_at: message.edited_at,
    }
}

fn message_error(error: MessageError) -> DocumentError {
    match error {
        MessageError::Forbidden => DocumentError::Unauthorized,
        error => DocumentError::Internal(anyhow::anyhow!(error.to_string())),
    }
}
