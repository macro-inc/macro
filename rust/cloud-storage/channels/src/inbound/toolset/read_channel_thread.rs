//! Tool for reading a channel message thread.

use super::ChannelToolContext;
use super::types::{
    ToolChannelMessage, ToolOmission, ToolOmissionKind, ToolResolvedMessage, ToolThreadReply,
    clamp_limit, clamp_max_chars, content_truncation_omissions,
};
use crate::domain::ports::ChannelMessagesService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Which part of a thread to read.
#[allow(missing_docs)]
#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChannelThreadWindowType {
    AllIfSmall,
    Latest,
    AroundReply,
}

/// Metadata about the thread being read.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadChannelThreadInfo {
    /// Channel id containing the thread.
    pub channel_id: Uuid,
    /// Thread id, equal to the top-level parent message id.
    pub thread_id: Uuid,
    /// Parent top-level message.
    pub parent: ToolChannelMessage,
    /// Total number of replies in this thread.
    pub reply_count: usize,
    /// Timestamp of the latest reply, if any.
    pub latest_reply_at: Option<DateTime<Utc>>,
}

/// Read replies from a channel thread.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadChannelThread",
    description = "Read replies from a channel message thread. The messageId may be either the top-level parent message id or any reply id in the thread. Use this after ReadChannelMessages or ContentSearch finds a relevant threaded discussion."
)]
pub struct ReadChannelThread {
    /// Channel id containing the thread.
    #[schemars(description = "Channel id containing the thread.")]
    pub channel_id: Uuid,
    /// Parent message id or any reply id in the thread.
    #[schemars(description = "Parent message id or any reply id in the thread.")]
    pub message_id: Uuid,
    /// Thread window to read. Defaults to latest replies.
    #[schemars(
        description = "Thread window to read: latest, allIfSmall, or aroundReply. Defaults to latest."
    )]
    #[serde(default)]
    pub window_type: Option<ChannelThreadWindowType>,
    /// Reply id to center around. Required when windowType is aroundReply.
    #[schemars(
        description = "Reply id to center around. Required when windowType is aroundReply."
    )]
    #[serde(default)]
    pub reply_id: Option<Uuid>,
    /// Number of replies before replyId for aroundReply windows. Defaults to 10, maximum 50.
    #[schemars(
        description = "Number of replies before replyId for aroundReply windows. Defaults to 10, maximum 50."
    )]
    #[serde(default)]
    pub before: Option<u16>,
    /// Number of replies after replyId for aroundReply windows. Defaults to 10, maximum 50.
    #[schemars(
        description = "Number of replies after replyId for aroundReply windows. Defaults to 10, maximum 50."
    )]
    #[serde(default)]
    pub after: Option<u16>,
    /// Maximum number of replies to return for latest/all-if-small windows. Defaults to 25, maximum 100.
    #[schemars(
        description = "Maximum number of replies to return for latest/all-if-small windows. Defaults to 25, maximum 100."
    )]
    #[serde(default)]
    pub limit: Option<u16>,
    /// Whether to include nearby top-level channel messages around the parent. Defaults to false.
    #[schemars(
        description = "Whether to include nearby top-level channel messages around the parent. Defaults to false."
    )]
    #[serde(default)]
    pub include_channel_context: Option<bool>,
    /// Maximum characters to return per message/reply. Defaults to 4000, maximum 16000.
    #[schemars(
        description = "Maximum characters to return per message/reply. Defaults to 4000, maximum 16000."
    )]
    #[serde(default)]
    pub max_chars_per_message: Option<usize>,
}

/// Response from `ReadChannelThread`.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadChannelThreadResponse {
    /// Resolution metadata for the requested message id.
    pub anchor: ToolResolvedMessage,
    /// Thread metadata and parent message.
    pub thread: ReadChannelThreadInfo,
    /// Replies returned for the requested window, in chronological order.
    pub replies: Vec<ToolThreadReply>,
    /// Nearby top-level channel messages around the parent, when requested.
    pub channel_context: Option<Vec<ToolChannelMessage>>,
    /// Information about omitted or truncated content.
    pub omissions: Vec<ToolOmission>,
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<ChannelToolContext<Svc, AccessSvc>> for ReadChannelThread
where
    Svc: ChannelMessagesService,
    AccessSvc: EntityAccessService,
{
    type Output = ReadChannelThreadResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ChannelToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        service_context
            .require_channel_member(&request_context, self.channel_id)
            .await?;

        let limit = clamp_limit(self.limit);
        let max_chars_per_message = clamp_max_chars(self.max_chars_per_message);

        let resolved = service_context
            .service
            .resolve_message(self.channel_id, self.message_id)
            .await
            .map_err(tool_err("failed to resolve channel message"))?;
        let anchor = ToolResolvedMessage::from(resolved.clone());

        let mut parent_page = service_context
            .service
            .get_channel_messages_around(self.channel_id, resolved.thread_id, 1)
            .await
            .map_err(tool_err("failed to read thread parent message"))?
            .page;
        let parent = parent_page.items.pop().ok_or_else(|| ToolCallError {
            description: "thread parent message not found".to_string(),
            internal_error: anyhow::anyhow!("thread parent not returned by channel service"),
        })?;
        let parent = ToolChannelMessage::from_message(parent, true, max_chars_per_message);

        let all_replies = service_context
            .service
            .get_thread_replies(self.channel_id, resolved.thread_id)
            .await
            .map_err(tool_err("failed to read channel thread replies"))?;
        let reply_count = all_replies.len();
        let latest_reply_at = all_replies.last().map(|reply| reply.created_at);

        let (reply_window, omitted_before, omitted_after) = select_replies(
            all_replies,
            self.window_type.unwrap_or(ChannelThreadWindowType::Latest),
            self.reply_id,
            self.before,
            self.after,
            limit,
        )?;

        let replies: Vec<ToolThreadReply> = reply_window
            .into_iter()
            .map(|reply| {
                ToolThreadReply::from_reply(reply, resolved.thread_id, max_chars_per_message)
            })
            .collect();

        let channel_context: Option<Vec<ToolChannelMessage>> =
            if self.include_channel_context.unwrap_or(false) {
                let mut page = service_context
                    .service
                    .get_channel_messages_around(self.channel_id, resolved.thread_id, 7)
                    .await
                    .map_err(tool_err("failed to read channel context around thread"))?
                    .page;
                page.items.reverse();
                Some(
                    page.items
                        .into_iter()
                        .map(|message| {
                            ToolChannelMessage::from_message(message, false, max_chars_per_message)
                        })
                        .collect(),
                )
            } else {
                None
            };

        let mut omissions = Vec::new();
        if omitted_before > 0 {
            omissions.push(ToolOmission {
                kind: ToolOmissionKind::ThreadReplies,
                message_id: None,
                thread_id: Some(resolved.thread_id),
                count: Some(omitted_before as i64),
                cursor: None,
            });
        }
        if omitted_after > 0 {
            omissions.push(ToolOmission {
                kind: ToolOmissionKind::ThreadReplies,
                message_id: None,
                thread_id: Some(resolved.thread_id),
                count: Some(omitted_after as i64),
                cursor: None,
            });
        }
        omissions.extend(content_truncation_omissions(
            std::slice::from_ref(&parent),
            &replies,
        ));
        if let Some(channel_context) = &channel_context {
            omissions.extend(content_truncation_omissions(channel_context, &[]));
        }

        Ok(ReadChannelThreadResponse {
            anchor,
            thread: ReadChannelThreadInfo {
                channel_id: self.channel_id,
                thread_id: resolved.thread_id,
                parent,
                reply_count,
                latest_reply_at,
            },
            replies,
            channel_context,
            omissions,
        })
    }
}

fn select_replies(
    replies: Vec<crate::domain::models::ThreadReply>,
    window_type: ChannelThreadWindowType,
    reply_id: Option<Uuid>,
    before: Option<u16>,
    after: Option<u16>,
    limit: u16,
) -> Result<(Vec<crate::domain::models::ThreadReply>, usize, usize), ToolCallError> {
    let total = replies.len();
    let limit = usize::from(limit);
    match window_type {
        ChannelThreadWindowType::AllIfSmall => {
            if total <= limit {
                Ok((replies, 0, 0))
            } else {
                let start = total.saturating_sub(limit);
                Ok((replies.into_iter().skip(start).collect(), start, 0))
            }
        }
        ChannelThreadWindowType::Latest => {
            let start = total.saturating_sub(limit);
            Ok((replies.into_iter().skip(start).collect(), start, 0))
        }
        ChannelThreadWindowType::AroundReply => {
            let reply_id = reply_id.ok_or_else(|| ToolCallError {
                description: "replyId is required when windowType is aroundReply".to_string(),
                internal_error: anyhow::anyhow!("missing thread reply anchor"),
            })?;
            let before = usize::from(before.unwrap_or(10).min(50));
            let after = usize::from(after.unwrap_or(10).min(50));
            let anchor_index = replies
                .iter()
                .position(|reply| reply.id == reply_id)
                .ok_or_else(|| ToolCallError {
                    description: "replyId was not found in this thread".to_string(),
                    internal_error: anyhow::anyhow!("thread reply anchor not found"),
                })?;
            let start = anchor_index.saturating_sub(before);
            let end = (anchor_index + after + 1).min(total);
            let omitted_after = total.saturating_sub(end);
            Ok((
                replies.into_iter().skip(start).take(end - start).collect(),
                start,
                omitted_after,
            ))
        }
    }
}

fn tool_err(
    description: &'static str,
) -> impl FnOnce(crate::domain::ports::ChannelMessagesErr) -> ToolCallError {
    move |err| ToolCallError {
        description: description.to_string(),
        internal_error: anyhow::Error::new(err),
    }
}
