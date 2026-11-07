//! ReadDiscussion tool for reading the comment threads on any item.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DiscussionParentType, MessageToolContext, comment_error};
use crate::domain::{
    discussions::live_threads,
    models::{Message, MessageThread, ThreadAnchor},
};

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadDiscussion",
    description = "Read the comment threads in the Discussion of a document, task, Tasks project (initiative), CRM company or CRM contact: each thread's id, resolved state and comments, with their ids, authors and text, oldest thread first. Thread and comment ids are what Comment, EditComment, DeleteComment and ResolveComment take. For a document, ReadContent returns the same threads alongside the content, with the live text each inline comment is on."
)]
/// Read every live thread in an item's Discussion.
pub struct ReadDiscussion {
    /// The kind of item.
    #[schemars(description = "The kind of item whose Discussion to read.")]
    pub entity_type: DiscussionParentType,

    /// The item.
    #[schemars(description = "The id of the item.")]
    pub entity_id: String,
}

/// A single comment in a thread.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionComment {
    /// The comment id.
    pub id: Uuid,
    /// The user or bot id of the author.
    pub author: String,
    /// The author's display name, for bots and imported comments.
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

/// A comment thread: its first comment followed by the replies.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionThread {
    /// The thread id, which is the id of its first comment. Replies and
    /// resolution address the thread by this id.
    pub id: Uuid,
    /// Whether the thread has been resolved.
    pub resolved: bool,
    /// For an inline comment on a document, the text it was written on;
    /// absent for a comment on the item as a whole. ReadContent has the
    /// text as the document reads now.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marked_text: Option<String>,
    /// The comments in order, first comment first.
    pub comments: Vec<DiscussionComment>,
}

/// The item's Discussion.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadDiscussionResponse {
    /// The kind of item.
    pub entity_type: DiscussionParentType,
    /// The item.
    pub entity_id: String,
    /// The live threads, oldest first.
    pub threads: Vec<DiscussionThread>,
}

impl ToolAnnotated for ReadDiscussion {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read discussion");
}

#[async_trait]
impl<ESvc: EntityAccessService> AsyncTool<MessageToolContext<ESvc>> for ReadDiscussion {
    type Output = ReadDiscussionResponse;

    #[tracing::instrument(skip_all, fields(entity_type = ?self.entity_type, entity_id = %self.entity_id), err)]
    async fn call(
        &self,
        ctx: ServiceContext<MessageToolContext<ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let parent = self
            .entity_type
            .parent(&self.entity_id)
            .map_err(|error| ToolCallError {
                description: format!(
                    "{} is not a valid {} id",
                    self.entity_id,
                    self.entity_type.noun()
                ),
                internal_error: error.into(),
            })?;
        let access = ctx.discussion_view(&request_context, &parent).await?;
        let threads = live_threads(ctx.messages.as_ref(), &access)
            .await
            .map_err(comment_error("unable to read the discussion"))?;

        Ok(ReadDiscussionResponse {
            entity_type: self.entity_type,
            entity_id: parent.entity_id(),
            threads: threads.into_iter().map(thread).collect(),
        })
    }
}

fn thread(thread: MessageThread) -> DiscussionThread {
    DiscussionThread {
        id: thread.root.id,
        resolved: thread.state.resolved,
        marked_text: match thread.state.anchor {
            Some(ThreadAnchor::Markdown { marked_text, .. })
            | Some(ThreadAnchor::PdfHighlight { marked_text, .. }) => marked_text,
            _ => None,
        },
        comments: std::iter::once(thread.root)
            .chain(thread.replies)
            .map(comment)
            .collect(),
    }
}

fn comment(message: Message) -> DiscussionComment {
    let deleted = message.deleted_at.is_some();
    DiscussionComment {
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
