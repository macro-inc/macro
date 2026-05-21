//! Tool for reading context around a specific channel message.

use super::ChannelToolContext;
use super::types::{
    ToolChannelMessage, ToolOmission, ToolOmissionKind, ToolResolvedMessage, ToolThreadReply,
    clamp_max_chars, content_truncation_omissions,
};
use crate::domain::models::ChannelMessageKind;
use crate::domain::ports::ChannelMessagesService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Top-level channel context around an anchor or thread parent.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolChannelMessageContextWindow {
    /// Older top-level messages before the anchor/parent, in chronological order.
    pub before: Vec<ToolChannelMessage>,
    /// The requested top-level message, or the parent if the requested message is a reply.
    pub anchor_or_parent: ToolChannelMessage,
    /// Newer top-level messages after the anchor/parent, in chronological order.
    pub after: Vec<ToolChannelMessage>,
}

/// Thread reply context around a reply anchor.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolThreadReplyContextWindow {
    /// Parent thread id.
    pub thread_id: Uuid,
    /// Parent top-level message.
    pub parent: ToolChannelMessage,
    /// Replies before the anchor reply, in chronological order.
    pub replies_before: Vec<ToolThreadReply>,
    /// Anchor reply, when the requested message was a thread reply.
    pub anchor_reply: Option<ToolThreadReply>,
    /// Replies after the anchor reply, in chronological order.
    pub replies_after: Vec<ToolThreadReply>,
    /// Number of earlier replies omitted from this context window.
    pub omitted_before: usize,
    /// Number of later replies omitted from this context window.
    pub omitted_after: usize,
}

/// Read local context around a specific channel message id.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadChannelMessageContext",
    description = "Read the local channel and thread context around one message id. If the id is a thread reply, this resolves the parent, returns nearby top-level channel messages, and returns nearby replies around the anchor reply."
)]
pub struct ReadChannelMessageContext {
    /// Channel id containing the message.
    #[schemars(description = "Channel id containing the message.")]
    pub channel_id: Uuid,
    /// Message id to anchor the context. May be top-level or a thread reply.
    #[schemars(
        description = "Message id to anchor the context. May be top-level or a thread reply."
    )]
    pub message_id: Uuid,
    /// Approximate number of older top-level messages to include. Defaults to 3.
    #[schemars(
        description = "Approximate number of older top-level messages to include. Defaults to 3."
    )]
    #[serde(default)]
    pub channel_before: Option<u16>,
    /// Approximate number of newer top-level messages to include. Defaults to 3.
    #[schemars(
        description = "Approximate number of newer top-level messages to include. Defaults to 3."
    )]
    #[serde(default)]
    pub channel_after: Option<u16>,
    /// Number of replies before a reply anchor to include. Defaults to 10, maximum 50.
    #[schemars(
        description = "Number of replies before a reply anchor to include. Defaults to 10, maximum 50."
    )]
    #[serde(default)]
    pub thread_before: Option<u16>,
    /// Number of replies after a reply anchor to include. Defaults to 10, maximum 50.
    #[schemars(
        description = "Number of replies after a reply anchor to include. Defaults to 10, maximum 50."
    )]
    #[serde(default)]
    pub thread_after: Option<u16>,
    /// Maximum characters to return per message/reply. Defaults to 4000, maximum 16000.
    #[schemars(
        description = "Maximum characters to return per message/reply. Defaults to 4000, maximum 16000."
    )]
    #[serde(default)]
    pub max_chars_per_message: Option<usize>,
}

/// Response from `ReadChannelMessageContext`.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadChannelMessageContextResponse {
    /// Resolution metadata for the requested message id.
    pub anchor: ToolResolvedMessage,
    /// Nearby top-level channel messages around the anchor or parent.
    pub channel_context: ToolChannelMessageContextWindow,
    /// Nearby thread replies when the requested message is a reply.
    pub thread_context: Option<ToolThreadReplyContextWindow>,
    /// Information about omitted or truncated content.
    pub omissions: Vec<ToolOmission>,
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<ChannelToolContext<Svc, AccessSvc>> for ReadChannelMessageContext
where
    Svc: ChannelMessagesService,
    AccessSvc: EntityAccessService,
{
    type Output = ReadChannelMessageContextResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ChannelToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        service_context
            .require_channel_member(&request_context, self.channel_id)
            .await?;

        let max_chars_per_message = clamp_max_chars(self.max_chars_per_message);
        let channel_before = self.channel_before.unwrap_or(3).min(25);
        let channel_after = self.channel_after.unwrap_or(3).min(25);
        let channel_limit = channel_before
            .saturating_add(channel_after)
            .saturating_add(1);

        let resolved = service_context
            .service
            .resolve_message(self.channel_id, self.message_id)
            .await
            .map_err(tool_err("failed to resolve channel message"))?;
        let anchor = ToolResolvedMessage::from(resolved.clone());

        let mut channel_page = service_context
            .service
            .get_channel_messages_around(self.channel_id, resolved.thread_id, channel_limit)
            .await
            .map_err(tool_err("failed to read channel context around message"))?
            .page;
        channel_page.items.reverse();
        let channel_messages: Vec<ToolChannelMessage> = channel_page
            .items
            .into_iter()
            .map(|message| ToolChannelMessage::from_message(message, true, max_chars_per_message))
            .collect();

        let parent_index = channel_messages
            .iter()
            .position(|message| message.id == resolved.thread_id)
            .ok_or_else(|| ToolCallError {
                description: "message parent was not returned in channel context".to_string(),
                internal_error: anyhow::anyhow!("channel context missing parent"),
            })?;
        let before = channel_messages[..parent_index].to_vec();
        let anchor_or_parent = channel_messages[parent_index].clone();
        let after = channel_messages[parent_index + 1..].to_vec();
        let channel_context = ToolChannelMessageContextWindow {
            before,
            anchor_or_parent: anchor_or_parent.clone(),
            after,
        };

        let thread_context = match resolved.kind {
            ChannelMessageKind::TopLevelMessage => None,
            ChannelMessageKind::ThreadReply => Some(
                read_reply_context(
                    &*service_context.service,
                    ReplyContextArgs {
                        channel_id: self.channel_id,
                        reply_id: self.message_id,
                        thread_id: resolved.thread_id,
                        parent: anchor_or_parent,
                        before: self.thread_before,
                        after: self.thread_after,
                        max_chars_per_message,
                    },
                )
                .await?,
            ),
        };

        let channel_context_messages = flatten_channel_context(&channel_context);
        let thread_context_replies = thread_context
            .as_ref()
            .map(flatten_thread_context)
            .unwrap_or_default();
        let mut omissions =
            content_truncation_omissions(&channel_context_messages, &thread_context_replies);
        if let Some(thread_context) = &thread_context {
            if thread_context.omitted_before > 0 {
                omissions.push(ToolOmission {
                    kind: ToolOmissionKind::ThreadReplies,
                    message_id: None,
                    thread_id: Some(thread_context.thread_id),
                    count: Some(thread_context.omitted_before as i64),
                    cursor: None,
                });
            }
            if thread_context.omitted_after > 0 {
                omissions.push(ToolOmission {
                    kind: ToolOmissionKind::ThreadReplies,
                    message_id: None,
                    thread_id: Some(thread_context.thread_id),
                    count: Some(thread_context.omitted_after as i64),
                    cursor: None,
                });
            }
        }

        Ok(ReadChannelMessageContextResponse {
            anchor,
            channel_context,
            thread_context,
            omissions,
        })
    }
}

struct ReplyContextArgs {
    channel_id: Uuid,
    reply_id: Uuid,
    thread_id: Uuid,
    parent: ToolChannelMessage,
    before: Option<u16>,
    after: Option<u16>,
    max_chars_per_message: usize,
}

async fn read_reply_context<Svc>(
    service: &Svc,
    args: ReplyContextArgs,
) -> Result<ToolThreadReplyContextWindow, ToolCallError>
where
    Svc: ChannelMessagesService,
{
    let before = usize::from(args.before.unwrap_or(10).min(50));
    let after = usize::from(args.after.unwrap_or(10).min(50));
    let replies = service
        .get_thread_replies(args.channel_id, args.reply_id)
        .await
        .map_err(tool_err("failed to read thread replies around message"))?;
    let total = replies.len();
    let anchor_index = replies
        .iter()
        .position(|reply| reply.id == args.reply_id)
        .ok_or_else(|| ToolCallError {
            description: "message_id was resolved as a reply, but was not found in thread replies"
                .to_string(),
            internal_error: anyhow::anyhow!("resolved reply not found in thread replies"),
        })?;
    let start = anchor_index.saturating_sub(before);
    let end = (anchor_index + after + 1).min(total);
    let omitted_after = total.saturating_sub(end);

    let mut mapped: Vec<ToolThreadReply> = replies
        .into_iter()
        .skip(start)
        .take(end - start)
        .map(|reply| ToolThreadReply::from_reply(reply, args.thread_id, args.max_chars_per_message))
        .collect();
    let anchor_offset = anchor_index - start;
    let replies_after = mapped.split_off(anchor_offset + 1);
    let anchor_reply = mapped.pop();
    let replies_before = mapped;

    Ok(ToolThreadReplyContextWindow {
        thread_id: args.thread_id,
        parent: args.parent,
        replies_before,
        anchor_reply,
        replies_after,
        omitted_before: start,
        omitted_after,
    })
}

fn flatten_channel_context(context: &ToolChannelMessageContextWindow) -> Vec<ToolChannelMessage> {
    let mut messages = context.before.clone();
    messages.push(context.anchor_or_parent.clone());
    messages.extend(context.after.clone());
    messages
}

fn flatten_thread_context(context: &ToolThreadReplyContextWindow) -> Vec<ToolThreadReply> {
    let mut replies = context.replies_before.clone();
    if let Some(anchor) = &context.anchor_reply {
        replies.push(anchor.clone());
    }
    replies.extend(context.replies_after.clone());
    replies
}

fn tool_err(
    description: &'static str,
) -> impl FnOnce(crate::domain::ports::ChannelMessagesErr) -> ToolCallError {
    move |err| ToolCallError {
        description: description.to_string(),
        internal_error: anyhow::Error::new(err),
    }
}
