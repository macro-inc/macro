//! EditComment tool for rewriting a comment or reply in any Discussion.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DiscussionParentType, MessageToolContext, comment_error};
use crate::domain::ports::{MessageError, MessagePatch};

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "EditComment",
    description = "Replace the text of a comment or reply in the Discussion of a document, task, Tasks project, CRM company or CRM contact. Only a comment's author can edit it, so this edits comments the user wrote and comments this assistant wrote for them. A comment id is enough to find its item. Comment ids come from ReadDiscussion, or from ReadContent for a document. Use only when the user asks to edit a comment."
)]
/// Replace the text of a comment the user or the tool actor wrote.
pub struct EditComment {
    /// The comment to edit.
    #[schemars(
        description = "The id of the comment or reply to edit. For the first comment of a thread this is the thread id."
    )]
    pub comment_id: Uuid,

    /// The replacement Macro Markdown body.
    #[schemars(description = "The full replacement text of the comment, in Macro markdown.")]
    pub content: String,
}

/// The edited comment.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditCommentResponse {
    /// The kind of item the comment is on.
    pub entity_type: DiscussionParentType,
    /// The item the comment is on.
    pub entity_id: String,
    /// The edited comment.
    pub comment_id: Uuid,
}

impl ToolAnnotated for EditComment {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Edit comment").with_idempotent();
}

#[async_trait]
impl<ESvc: EntityAccessService> AsyncTool<MessageToolContext<ESvc>> for EditComment {
    type Output = EditCommentResponse;

    #[tracing::instrument(skip_all, fields(comment_id = %self.comment_id), err)]
    async fn call(
        &self,
        ctx: ServiceContext<MessageToolContext<ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        if self.content.trim().is_empty() {
            return Err(ToolCallError {
                description:
                    "comment text must not be empty; use DeleteComment to remove a comment"
                        .to_owned(),
                internal_error: MessageError::Invalid("empty comment edit").into(),
            });
        }
        let (kind, parent) = ctx.discussion_of(self.comment_id).await?;
        let access = ctx
            .comment_author_write(&request_context, &parent, self.comment_id)
            .await?;
        ctx.messages
            .patch(
                access,
                self.comment_id,
                MessagePatch {
                    content: Some(self.content.clone()),
                    ..MessagePatch::default()
                },
            )
            .await
            .map_err(|error| match error {
                MessageError::Forbidden => ToolCallError {
                    description: "only the comment's author can edit it".to_owned(),
                    internal_error: error.into(),
                },
                error => comment_error("unable to edit the comment")(error),
            })?;

        Ok(EditCommentResponse {
            entity_type: kind,
            entity_id: parent.entity_id(),
            comment_id: self.comment_id,
        })
    }
}
