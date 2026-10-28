//! Comment tool for posting a Discussion comment or a reply on any item.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DiscussionParentType, MessageToolContext, comment_error, parse_target};
use crate::domain::{
    models::{MessageAttribution, PostMessage, PostMessageNotificationPolicy},
    ports::MessageError,
};

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "Comment",
    description = "Add a comment to the Discussion of a document, task, Tasks project (initiative), CRM company or CRM contact on behalf of the user, or reply in an existing comment thread on any of them. For a new comment, address the item by entityType and entityId. For a reply, pass threadId; a thread id is enough to find its item, so entityType and entityId may be omitted. Thread ids come from ReadDiscussion, or from ReadContent for a document. Only use this when explicitly asked to comment or reply. Write content in Macro markdown and link people and items with the same mention tags as in documents; they render as chips and notify the people mentioned. To comment on a passage of text in a document, use CommentOnText instead; for a message in a channel, use SendChannelMessage."
)]
/// Post a Discussion comment on an item, or a reply in one of its threads.
pub struct Comment {
    /// The kind of item, with `entity_id`; optional for a reply.
    #[schemars(
        description = "The kind of item to comment on. Required with entityId for a new comment; optional for a reply."
    )]
    pub entity_type: Option<DiscussionParentType>,

    /// The item, with `entity_type`; optional for a reply.
    #[schemars(
        description = "The id of the item to comment on. Required with entityType for a new comment; optional for a reply."
    )]
    pub entity_id: Option<String>,

    /// The thread to reply in; absent starts a new thread.
    #[schemars(
        description = "The id of the thread to reply in. Omit to start a new Discussion comment on the item."
    )]
    pub thread_id: Option<Uuid>,

    /// Macro Markdown body.
    #[schemars(
        description = "Comment content in Macro markdown, the same syntax as markdown documents, including mention tags."
    )]
    pub content: String,
}

/// The posted comment.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommentResponse {
    /// The kind of item the comment is on.
    pub entity_type: DiscussionParentType,
    /// The item the comment is on.
    pub entity_id: String,
    /// The thread the comment is in; a new comment starts its own.
    pub thread_id: Uuid,
    /// The posted comment.
    pub comment_id: Uuid,
}

impl ToolAnnotated for Comment {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Comment");
}

#[async_trait]
impl<ESvc: EntityAccessService> AsyncTool<MessageToolContext<ESvc>> for Comment {
    type Output = CommentResponse;

    #[tracing::instrument(skip_all, fields(entity_type = ?self.entity_type, entity_id = ?self.entity_id, thread_id = ?self.thread_id), err)]
    async fn call(
        &self,
        ctx: ServiceContext<MessageToolContext<ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let target = parse_target(self.entity_type, self.entity_id.as_deref())?;
        let (kind, parent) = match (target, self.thread_id) {
            (Some(target), _) => target,
            (None, Some(thread_id)) => ctx.discussion_of(thread_id).await?,
            (None, None) => {
                return Err(ToolCallError {
                    description:
                        "pass entityType and entityId for a new comment, or threadId for a reply"
                            .to_owned(),
                    internal_error: MessageError::Invalid("comment without a target").into(),
                });
            }
        };
        let access = ctx.discussion_write(&request_context, &parent).await?;
        let message = ctx
            .messages
            .post(
                access,
                PostMessage {
                    id: None,
                    attribution: MessageAttribution::ActingUser,
                    notification_policy: PostMessageNotificationPolicy::Default,
                    content: self.content.clone(),
                    thread_id: self.thread_id,
                    anchor: None,
                    mentions: vec![],
                    attachments: vec![],
                    nonce: None,
                },
            )
            .await
            .map_err(comment_error("unable to post the comment"))?;

        Ok(CommentResponse {
            entity_type: kind,
            entity_id: parent.entity_id(),
            thread_id: message.root_id(),
            comment_id: message.id,
        })
    }
}
