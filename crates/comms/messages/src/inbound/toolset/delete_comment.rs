//! DeleteComment tool for deleting a comment, reply, or whole thread in any
//! Discussion.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DiscussionParentType, MessageToolContext, comment_error};
use crate::domain::ports::MessageError;

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DeleteComment",
    description = "Delete a comment or reply in the Discussion of a document, task, Tasks project, CRM company or CRM contact. Deleting the first comment of a thread deletes the whole thread with its replies. Authors can delete their own comments, and the item's owner can delete any comment. This cannot be undone. A comment id is enough to find its item. Comment ids come from ReadDiscussion, or from ReadContent for a document. Use only when the user explicitly asks to delete a comment; use ResolveComment to close a thread instead."
)]
/// Delete a comment, or a whole thread by its first comment.
pub struct DeleteComment {
    /// The comment to delete; a thread's first comment deletes the thread.
    #[schemars(
        description = "The id of the comment or reply to delete. Pass the thread id to delete the whole thread."
    )]
    pub comment_id: Uuid,
}

/// The deleted comment.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCommentResponse {
    /// The kind of item the comment was on.
    pub entity_type: DiscussionParentType,
    /// The item the comment was on.
    pub entity_id: String,
    /// The deleted comment.
    pub comment_id: Uuid,
    /// Whether the whole thread was deleted.
    pub deleted_thread: bool,
}

impl ToolAnnotated for DeleteComment {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Delete comment").with_idempotent();
}

#[async_trait]
impl<ESvc: EntityAccessService> AsyncTool<MessageToolContext<ESvc>> for DeleteComment {
    type Output = DeleteCommentResponse;

    #[tracing::instrument(skip_all, fields(comment_id = %self.comment_id), err)]
    async fn call(
        &self,
        ctx: ServiceContext<MessageToolContext<ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let (kind, parent) = ctx.discussion_of(self.comment_id).await?;
        let access = ctx
            .comment_author_write(&request_context, &parent, self.comment_id)
            .await?;
        let deleted = ctx
            .messages
            .delete(access, self.comment_id, None)
            .await
            .map_err(|error| match error {
                MessageError::Forbidden => ToolCallError {
                    description: format!(
                        "only the comment's author or the {}'s owner can delete it",
                        kind.noun()
                    ),
                    internal_error: error.into(),
                },
                error => comment_error("unable to delete the comment")(error),
            })?;

        Ok(DeleteCommentResponse {
            entity_type: kind,
            entity_id: parent.entity_id(),
            comment_id: self.comment_id,
            deleted_thread: deleted.thread_id.is_none(),
        })
    }
}
