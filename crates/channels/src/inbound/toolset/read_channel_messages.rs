//! Tool for reading bounded channel timeline windows.
use messages::domain::ports::{MessageDirection, MessageTimelineQuery};

use super::ChannelToolContext;
use super::types::{
    PageDirection, ToolChannelMessage, ToolNavigation, ToolOmission, ToolOmissionKind, clamp_limit,
    clamp_max_chars, content_truncation_omissions,
};
use crate::domain::ports::ChannelService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Type of channel timeline window to read.
#[allow(missing_docs)]
#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChannelMessagesWindowType {
    Latest,
    TimeRange,
    AroundMessage,
    Page,
    Messages,
}

/// Resolved window metadata echoed in the response.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedChannelMessagesWindow {
    /// Window type that was read.
    pub window_type: ChannelMessagesWindowType,
    /// Inclusive lower bound for activity timestamps, for time range windows.
    pub from: Option<DateTime<Utc>>,
    /// Exclusive upper bound for activity timestamps, for time range windows.
    pub to: Option<DateTime<Utc>>,
    /// Anchor message id for around-message windows.
    pub message_id: Option<Uuid>,
    /// Cursor direction for page windows.
    pub direction: Option<PageDirection>,
    /// Requested message ids for messages windows.
    pub message_ids: Vec<Uuid>,
}

/// Read a bounded, structured window of top-level channel messages.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadChannelMessages",
    description = "Read a small structured window of top-level messages from a channel. Use this for latest messages, bounded time ranges, cursor continuation, or a window around a message. For full thread replies, use ReadChannelThread."
)]
pub struct ReadChannelMessages {
    /// Channel id to read.
    #[schemars(description = "Channel id to read.")]
    pub channel_id: Uuid,
    /// Which channel window to read.
    #[schemars(
        description = "Which bounded channel window to read: latest, timeRange, aroundMessage, page, or messages."
    )]
    pub window_type: ChannelMessagesWindowType,
    /// Inclusive lower bound for activity timestamps. Required when windowType is timeRange.
    #[schemars(
        description = "Inclusive lower bound for activity timestamps. Required when windowType is timeRange."
    )]
    #[serde(default)]
    pub from: Option<DateTime<Utc>>,
    /// Exclusive upper bound for activity timestamps. Required when windowType is timeRange.
    #[schemars(
        description = "Exclusive upper bound for activity timestamps. Required when windowType is timeRange."
    )]
    #[serde(default)]
    pub to: Option<DateTime<Utc>>,
    /// Anchor message id. Required when windowType is aroundMessage.
    #[schemars(description = "Anchor message id. Required when windowType is aroundMessage.")]
    #[serde(default)]
    pub message_id: Option<Uuid>,
    /// Opaque cursor returned by this tool. Required when windowType is page.
    #[schemars(
        description = "Opaque cursor returned by this tool. Required when windowType is page."
    )]
    #[serde(default)]
    pub cursor: Option<String>,
    /// Direction to read from the cursor. Required when windowType is page.
    #[schemars(
        description = "Direction to read from the cursor. Required when windowType is page."
    )]
    #[serde(default)]
    pub direction: Option<PageDirection>,
    /// Top-level message ids to read. Required when windowType is messages.
    #[schemars(
        description = "Top-level message ids to read. Required when windowType is messages."
    )]
    #[serde(default)]
    pub message_ids: Vec<Uuid>,
    /// Maximum number of top-level messages to return. Defaults to 25, maximum 100.
    #[schemars(
        description = "Maximum number of top-level messages to return. Defaults to 25, maximum 100."
    )]
    #[serde(default)]
    pub limit: Option<u16>,
    /// Whether to include thread preview replies on returned top-level messages. Defaults to true.
    #[schemars(
        description = "Whether to include thread preview replies on returned top-level messages. Defaults to true."
    )]
    #[serde(default)]
    pub include_thread_previews: Option<bool>,
    /// Maximum characters to return per message/reply. Defaults to 4000, maximum 16000.
    #[schemars(
        description = "Maximum characters to return per message/reply. Defaults to 4000, maximum 16000."
    )]
    #[serde(default)]
    pub max_chars_per_message: Option<usize>,
}

/// Response from `ReadChannelMessages`.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadChannelMessagesResponse {
    /// Channel id that was read.
    pub channel_id: Uuid,
    /// Resolved window metadata.
    pub window: ResolvedChannelMessagesWindow,
    /// Top-level channel messages in chronological order.
    pub messages: Vec<ToolChannelMessage>,
    /// Continuation cursors and paging hints.
    pub navigation: ToolNavigation,
    /// Information about omitted or truncated content.
    pub omissions: Vec<ToolOmission>,
}

impl ToolAnnotated for ReadChannelMessages {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read channel messages");
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<ChannelToolContext<Svc, AccessSvc>> for ReadChannelMessages
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    type Output = ReadChannelMessagesResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ChannelToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let access = service_context
            .require_channel_member(&request_context, self.channel_id)
            .await?;
        let required = |name: &str| ToolCallError {
            description: format!("{name} is required for this window"),
            internal_error: anyhow::anyhow!("missing window argument"),
        };
        let mut query = match self.window_type {
            ChannelMessagesWindowType::Latest => MessageTimelineQuery::default(),
            ChannelMessagesWindowType::TimeRange => MessageTimelineQuery {
                activity_after: Some(self.from.ok_or_else(|| required("from"))?),
                activity_before: Some(self.to.ok_or_else(|| required("to"))?),
                ..Default::default()
            },
            ChannelMessagesWindowType::AroundMessage => MessageTimelineQuery {
                around: Some(self.message_id.ok_or_else(|| required("messageId"))?),
                ..Default::default()
            },
            ChannelMessagesWindowType::Messages => {
                if self.message_ids.is_empty() {
                    return Err(required("messageIds"));
                }
                MessageTimelineQuery {
                    ids: self.message_ids.clone(),
                    ..Default::default()
                }
            }
            ChannelMessagesWindowType::Page => {
                let mut query: MessageTimelineQuery =
                    serde_json::from_str(self.cursor.as_deref().ok_or_else(|| required("cursor"))?)
                        .map_err(|error| ToolCallError {
                            description: "invalid message cursor".into(),
                            internal_error: error.into(),
                        })?;
                query.direction = match self.direction.ok_or_else(|| required("direction"))? {
                    PageDirection::Older => MessageDirection::Older,
                    PageDirection::Newer => MessageDirection::Newer,
                };
                query
            }
        };
        query.limit = Some(clamp_limit(self.limit));
        let page = service_context
            .messages
            .timeline(access, query.clone())
            .await
            .map_err(tool_err("failed to read messages"))?;
        let continuation =
            |cursor: Option<messages::domain::ports::MessageCursor>, direction| -> Option<String> {
                cursor.map(|cursor| {
                    serde_json::to_string(&MessageTimelineQuery {
                        cursor: Some(cursor),
                        around: None,
                        direction,
                        ..query.clone()
                    })
                    .expect("message query is serializable")
                })
            };
        let navigation = ToolNavigation {
            has_more_older: page.next_cursor.is_some(),
            has_more_newer: page.previous_cursor.is_some(),
            older_cursor: continuation(page.next_cursor, MessageDirection::Older),
            newer_cursor: continuation(page.previous_cursor, MessageDirection::Newer),
        };
        let messages: Vec<_> = page
            .items
            .into_iter()
            .rev()
            .map(|message| {
                ToolChannelMessage::from_message(
                    message,
                    self.channel_id,
                    self.include_thread_previews.unwrap_or(true),
                    clamp_max_chars(self.max_chars_per_message),
                )
            })
            .collect();
        let mut omissions = content_truncation_omissions(&messages, &[]);
        for message in &messages {
            if message.thread.omitted_reply_count > 0 {
                omissions.push(ToolOmission {
                    kind: ToolOmissionKind::ThreadReplies,
                    message_id: Some(message.id),
                    thread_id: Some(message.id),
                    count: Some(message.thread.omitted_reply_count),
                    cursor: None,
                });
            }
        }
        Ok(ReadChannelMessagesResponse {
            channel_id: self.channel_id,
            window: ResolvedChannelMessagesWindow {
                window_type: self.window_type,
                from: query.activity_after,
                to: query.activity_before,
                message_id: query.around,
                direction: self.direction,
                message_ids: query.ids,
            },
            messages,
            navigation,
            omissions,
        })
    }
}

fn tool_err(
    description: &'static str,
) -> impl FnOnce(messages::domain::ports::MessageError) -> ToolCallError {
    move |err| ToolCallError {
        description: description.into(),
        internal_error: anyhow::Error::new(err),
    }
}
