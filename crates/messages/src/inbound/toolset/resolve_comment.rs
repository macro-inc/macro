//! ResolveComment tool for resolving and reopening comment threads in any
//! Discussion.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DiscussionParentType, MessageToolContext, comment_error};
use crate::domain::models::ThreadPatch;

fn default_resolved() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ResolveComment",
    description = "Resolve or reopen a comment thread in the Discussion of a document, task, Tasks project, CRM company or CRM contact on behalf of the user. A thread id is enough to find its item. Only use this when explicitly asked to resolve or reopen a comment. Thread ids come from ReadDiscussion, or from ReadContent for a document."
)]
/// Resolve or reopen a comment thread.
pub struct ResolveComment {
    /// The thread to change.
    #[schemars(description = "The id of the thread to resolve or reopen.")]
    pub thread_id: Uuid,

    /// Whether the thread should be resolved; defaults to true.
    #[serde(default = "default_resolved")]
    #[schemars(
        description = "True to resolve the thread, false to reopen a resolved thread. Defaults to true."
    )]
    pub resolved: bool,
}

/// The thread's state after the change.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolveCommentResponse {
    /// The kind of item the thread is on.
    pub entity_type: DiscussionParentType,
    /// The item the thread is on.
    pub entity_id: String,
    /// The thread that was changed.
    pub thread_id: Uuid,
    /// Whether the thread is now resolved.
    pub resolved: bool,
}

impl ToolAnnotated for ResolveComment {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Resolve comment");
}

#[async_trait]
impl<ESvc: EntityAccessService> AsyncTool<MessageToolContext<ESvc>> for ResolveComment {
    type Output = ResolveCommentResponse;

    #[tracing::instrument(skip_all, fields(thread_id = %self.thread_id, resolved = self.resolved), err)]
    async fn call(
        &self,
        ctx: ServiceContext<MessageToolContext<ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let (kind, parent) = ctx.discussion_of(self.thread_id).await?;
        let access = ctx.discussion_write(&request_context, &parent).await?;
        let state = ctx
            .messages
            .patch_thread(
                access,
                self.thread_id,
                ThreadPatch {
                    resolved: Some(self.resolved),
                    detach_anchor: false,
                    nonce: None,
                },
            )
            .await
            .map_err(comment_error("unable to update the comment thread"))?;

        Ok(ResolveCommentResponse {
            entity_type: kind,
            entity_id: parent.entity_id(),
            thread_id: state.root_id,
            resolved: state.resolved,
        })
    }
}
