//! Semantic project discussion reads.

use super::*;
use crate::domain::{
    models::{MessageListItem, MessageThread},
    ports::{MessageCursor, MessageTimelineQuery},
    service::MessageView,
};
use ai_toolset::{AsyncTool, ServiceContext, ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Read a project's recent discussions or one complete discussion.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadInitiativeDiscussions",
    description = "Read discussions and comments on a project using Macro's shared discussions system. Without threadId returns up to 100 roots with reply previews. Pass nextCursor back as cursor with the same date filters to read older roots. Use a root id as threadId to read the complete discussion. Date filters select discussions with activity in that interval."
)]
pub struct ReadInitiativeDiscussions {
    /// Project identifier.
    #[schemars(description = "Project identifier.")]
    pub initiative_id: Uuid,
    /// Root message id for a complete thread. Omit to list discussions.
    #[schemars(description = "Root message id for a complete thread. Omit to list discussions.")]
    pub thread_id: Option<Uuid>,
    /// Include discussions with roots or live replies at or after this timestamp.
    #[schemars(
        description = "Include discussions with roots or live replies at or after this timestamp."
    )]
    pub after: Option<DateTime<Utc>>,
    /// Include discussions with roots or live replies before this timestamp.
    #[schemars(
        description = "Include discussions with roots or live replies before this timestamp."
    )]
    pub before: Option<DateTime<Utc>>,
    /// Opaque nextCursor from the preceding timeline page; omit when reading a thread.
    #[schemars(
        description = "Opaque nextCursor from the preceding timeline page; omit when reading a thread."
    )]
    pub cursor: Option<MessageCursor>,
    /// Maximum roots to return, from 1 through 100; defaults to 100.
    #[schemars(description = "Maximum roots to return, from 1 through 100; defaults to 100.")]
    pub limit: Option<u16>,
}

/// One full thread or a bounded timeline.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum InitiativeDiscussionsResult {
    /// A complete discussion.
    Thread {
        /// Root, thread state and replies.
        thread: MessageThread,
    },
    /// Discussion roots with bounded reply previews.
    Timeline {
        /// Matching discussion roots.
        discussions: Vec<MessageListItem>,
        /// More discussions may match; follow nextCursor.
        truncated: bool,
        /// Stable continuation, absent after the final matching page.
        next_cursor: Option<MessageCursor>,
    },
}

impl ToolAnnotated for ReadInitiativeDiscussions {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read project discussions");
}

#[async_trait]
impl<A: EntityAccessService> AsyncTool<InitiativeDiscussionToolContext<A>>
    for ReadInitiativeDiscussions
{
    type Output = InitiativeDiscussionsResult;
    async fn call(
        &self,
        context: ServiceContext<InitiativeDiscussionToolContext<A>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = context
            .receipt::<MessageView>(&request, self.initiative_id)
            .await?;
        if let Some(root) = self.thread_id {
            let thread = context
                .service
                .get_thread(receipt, root)
                .await
                .map_err(failure)?;
            return Ok(InitiativeDiscussionsResult::Thread { thread });
        }
        if self.limit.is_some_and(|limit| !(1..=100).contains(&limit)) {
            return Err(failure(crate::domain::ports::MessageError::Invalid(
                "limit must be between 1 and 100",
            )));
        }
        let page = context
            .service
            .timeline(
                receipt,
                MessageTimelineQuery {
                    activity_after: self.after,
                    activity_before: self.before,
                    cursor: self.cursor.clone(),
                    limit: self.limit.or(Some(100)),
                    ..Default::default()
                },
            )
            .await
            .map_err(failure)?;
        Ok(InitiativeDiscussionsResult::Timeline {
            discussions: page.items,
            truncated: page.next_cursor.is_some(),
            next_cursor: page.next_cursor,
        })
    }
}
