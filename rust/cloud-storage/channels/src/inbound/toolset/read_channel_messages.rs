//! Tool for reading bounded channel timeline windows.

use super::ChannelToolContext;
use super::types::{
    PageDirection, ToolChannelMessage, ToolNavigation, ToolOmission, ToolOmissionKind, clamp_limit,
    clamp_max_chars, content_truncation_omissions,
};
use crate::domain::models::{ChannelMessageFilters, MessagePageDirection};
use crate::domain::ports::{ChannelMessagesQueryResult, ChannelMessagesService};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::ports::EntityAccessService;
use models_pagination::{Base64Str, CreatedAt, Cursor, CursorVal, CursorWithValAndFilter, Query};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelMessagesCursorFilter {
    #[serde(default)]
    message_ids: Vec<Uuid>,
    #[serde(default)]
    created_after: Option<DateTime<Utc>>,
    #[serde(default)]
    created_before: Option<DateTime<Utc>>,
    #[serde(default)]
    activity_after: Option<DateTime<Utc>>,
    #[serde(default)]
    activity_before: Option<DateTime<Utc>>,
}

impl ChannelMessagesCursorFilter {
    fn to_channel_message_filters(&self) -> ChannelMessageFilters {
        ChannelMessageFilters {
            message_ids: self.message_ids.clone(),
            created_after: self.created_after,
            created_before: self.created_before,
            activity_after: self.activity_after,
            activity_before: self.activity_before,
            ..Default::default()
        }
    }
}

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

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<ChannelToolContext<Svc, AccessSvc>> for ReadChannelMessages
where
    Svc: ChannelMessagesService,
    AccessSvc: EntityAccessService,
{
    type Output = ReadChannelMessagesResponse;

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
        let include_thread_preview = self.include_thread_previews.unwrap_or(true);

        let (page, has_more_newer, resolved_window, cursor_filter) = match self.window_type {
            ChannelMessagesWindowType::Latest => {
                let cursor_filter = ChannelMessagesCursorFilter::default();
                let ChannelMessagesQueryResult {
                    page,
                    has_more_newer,
                } = service_context
                    .service
                    .get_channel_messages(
                        self.channel_id,
                        Query::Sort(CreatedAt, ()),
                        MessagePageDirection::Older,
                        limit,
                        &cursor_filter.to_channel_message_filters(),
                        None,
                    )
                    .await
                    .map_err(tool_err("failed to read latest channel messages"))?;
                (
                    page,
                    has_more_newer,
                    resolved_window(ChannelMessagesWindowType::Latest, self),
                    cursor_filter,
                )
            }
            ChannelMessagesWindowType::TimeRange => {
                let from = self.from.ok_or_else(|| ToolCallError {
                    description: "from is required when windowType is timeRange".to_string(),
                    internal_error: anyhow::anyhow!("missing time range from"),
                })?;
                let to = self.to.ok_or_else(|| ToolCallError {
                    description: "to is required when windowType is timeRange".to_string(),
                    internal_error: anyhow::anyhow!("missing time range to"),
                })?;
                if from >= to {
                    return Err(ToolCallError {
                        description: "time range `from` must be before `to`".to_string(),
                        internal_error: anyhow::anyhow!("invalid channel message time range"),
                    });
                }
                let cursor_filter = ChannelMessagesCursorFilter {
                    activity_after: Some(from),
                    activity_before: Some(to),
                    ..Default::default()
                };
                let filters = cursor_filter.to_channel_message_filters();
                let ChannelMessagesQueryResult {
                    page,
                    has_more_newer,
                } = service_context
                    .service
                    .get_channel_messages(
                        self.channel_id,
                        Query::Sort(CreatedAt, ()),
                        MessagePageDirection::Older,
                        limit,
                        &filters,
                        None,
                    )
                    .await
                    .map_err(tool_err("failed to read channel messages in time range"))?;
                (
                    page,
                    has_more_newer,
                    resolved_window(ChannelMessagesWindowType::TimeRange, self),
                    cursor_filter,
                )
            }
            ChannelMessagesWindowType::AroundMessage => {
                let cursor_filter = ChannelMessagesCursorFilter::default();
                let message_id = self.message_id.ok_or_else(|| ToolCallError {
                    description: "messageId is required when windowType is aroundMessage"
                        .to_string(),
                    internal_error: anyhow::anyhow!("missing around-message id"),
                })?;
                let ChannelMessagesQueryResult {
                    page,
                    has_more_newer,
                } = service_context
                    .service
                    .get_channel_messages_around(self.channel_id, message_id, limit)
                    .await
                    .map_err(tool_err("failed to read channel messages around message"))?;
                (
                    page,
                    has_more_newer,
                    resolved_window(ChannelMessagesWindowType::AroundMessage, self),
                    cursor_filter,
                )
            }
            ChannelMessagesWindowType::Page => {
                let cursor = self.cursor.as_deref().ok_or_else(|| ToolCallError {
                    description: "cursor is required when windowType is page".to_string(),
                    internal_error: anyhow::anyhow!("missing channel cursor"),
                })?;
                let direction = self.direction.ok_or_else(|| ToolCallError {
                    description: "direction is required when windowType is page".to_string(),
                    internal_error: anyhow::anyhow!("missing channel cursor direction"),
                })?;
                let cursor = decode_channel_cursor(cursor)?;
                let cursor_filter = cursor.filter.clone();
                let filters = cursor_filter.to_channel_message_filters();
                let direction_for_service = match direction {
                    PageDirection::Older => MessagePageDirection::Older,
                    PageDirection::Newer => MessagePageDirection::Newer,
                };
                let ChannelMessagesQueryResult {
                    page,
                    has_more_newer,
                } = service_context
                    .service
                    .get_channel_messages(
                        self.channel_id,
                        Query::Cursor(cursor.map_filter(|_| ())),
                        direction_for_service,
                        limit,
                        &filters,
                        None,
                    )
                    .await
                    .map_err(tool_err("failed to read channel message page"))?;
                let resolved_window = ResolvedChannelMessagesWindow {
                    window_type: ChannelMessagesWindowType::Page,
                    from: cursor_filter.activity_after,
                    to: cursor_filter.activity_before,
                    message_id: self.message_id,
                    direction: self.direction,
                    message_ids: cursor_filter.message_ids.clone(),
                };
                (page, has_more_newer, resolved_window, cursor_filter)
            }
            ChannelMessagesWindowType::Messages => {
                if self.message_ids.is_empty() {
                    return Err(ToolCallError {
                        description: "message_ids must not be empty".to_string(),
                        internal_error: anyhow::anyhow!("empty channel message id list"),
                    });
                }
                let cursor_filter = ChannelMessagesCursorFilter {
                    message_ids: self.message_ids.clone(),
                    ..Default::default()
                };
                let filters = cursor_filter.to_channel_message_filters();
                let ChannelMessagesQueryResult {
                    page,
                    has_more_newer,
                } = service_context
                    .service
                    .get_channel_messages(
                        self.channel_id,
                        Query::Sort(CreatedAt, ()),
                        MessagePageDirection::Older,
                        limit,
                        &filters,
                        None,
                    )
                    .await
                    .map_err(tool_err("failed to read requested channel messages"))?;
                (
                    page,
                    has_more_newer,
                    resolved_window(ChannelMessagesWindowType::Messages, self),
                    cursor_filter,
                )
            }
        };

        let service_has_more_older = page.next_cursor.is_some();
        let mut raw_messages = page.items;
        raw_messages.reverse();
        let messages: Vec<ToolChannelMessage> = raw_messages
            .into_iter()
            .map(|message| {
                ToolChannelMessage::from_message(
                    message,
                    include_thread_preview,
                    max_chars_per_message,
                )
            })
            .collect();

        let has_more_older = match self.window_type {
            ChannelMessagesWindowType::Messages => false,
            ChannelMessagesWindowType::Page if self.direction == Some(PageDirection::Newer) => {
                !messages.is_empty()
            }
            _ => service_has_more_older,
        };
        let older_cursor = has_more_older
            .then(|| cursor_from_oldest_message(&messages, limit, cursor_filter.clone()))
            .flatten();

        let has_more_newer = match self.window_type {
            ChannelMessagesWindowType::Latest
            | ChannelMessagesWindowType::Messages
            | ChannelMessagesWindowType::AroundMessage => false,
            _ => has_more_newer,
        };
        let can_read_newer =
            has_more_newer || matches!(self.window_type, ChannelMessagesWindowType::AroundMessage);
        let newer_cursor = can_read_newer
            .then(|| cursor_from_newest_message(&messages, limit, cursor_filter.clone()))
            .flatten();

        let mut omissions = Vec::new();
        if let Some(cursor) = older_cursor.clone() {
            omissions.push(ToolOmission {
                kind: ToolOmissionKind::OlderMessages,
                message_id: None,
                thread_id: None,
                count: None,
                cursor: Some(cursor),
            });
        }
        if has_more_newer {
            omissions.push(ToolOmission {
                kind: ToolOmissionKind::NewerMessages,
                message_id: None,
                thread_id: None,
                count: None,
                cursor: newer_cursor.clone(),
            });
        }
        for message in &messages {
            if message.thread.omitted_reply_count > 0 {
                omissions.push(ToolOmission {
                    kind: ToolOmissionKind::ThreadReplies,
                    message_id: Some(message.id),
                    thread_id: Some(message.thread.thread_id),
                    count: Some(message.thread.omitted_reply_count),
                    cursor: None,
                });
            }
        }
        omissions.extend(content_truncation_omissions(&messages, &[]));

        Ok(ReadChannelMessagesResponse {
            channel_id: self.channel_id,
            window: resolved_window,
            messages,
            navigation: ToolNavigation {
                has_more_older,
                has_more_newer,
                older_cursor,
                newer_cursor,
            },
            omissions,
        })
    }
}

fn resolved_window(
    window_type: ChannelMessagesWindowType,
    tool: &ReadChannelMessages,
) -> ResolvedChannelMessagesWindow {
    ResolvedChannelMessagesWindow {
        window_type,
        from: tool.from,
        to: tool.to,
        message_id: tool.message_id,
        direction: tool.direction,
        message_ids: tool.message_ids.clone(),
    }
}

fn decode_channel_cursor(
    cursor: &str,
) -> Result<CursorWithValAndFilter<Uuid, CreatedAt, ChannelMessagesCursorFilter>, ToolCallError> {
    Base64Str::new_from_string(cursor.to_string())
        .decode_json()
        .map_err(|err| ToolCallError {
            description: "invalid channel cursor".to_string(),
            internal_error: anyhow::anyhow!("invalid channel cursor: {err:?}"),
        })
}

fn cursor_from_oldest_message(
    messages: &[ToolChannelMessage],
    limit: u16,
    filter: ChannelMessagesCursorFilter,
) -> Option<String> {
    messages
        .first()
        .map(|message| cursor_from_message(message, limit, filter))
}

fn cursor_from_newest_message(
    messages: &[ToolChannelMessage],
    limit: u16,
    filter: ChannelMessagesCursorFilter,
) -> Option<String> {
    messages
        .last()
        .map(|message| cursor_from_message(message, limit, filter))
}

fn cursor_from_message(
    message: &ToolChannelMessage,
    limit: u16,
    filter: ChannelMessagesCursorFilter,
) -> String {
    Base64Str::encode_json(Cursor {
        id: message.id,
        limit: usize::from(limit),
        val: CursorVal {
            sort_type: CreatedAt,
            last_val: message.created_at,
        },
        filter,
    })
    .type_erase()
}

fn tool_err(
    description: &'static str,
) -> impl FnOnce(crate::domain::ports::ChannelMessagesErr) -> ToolCallError {
    move |err| ToolCallError {
        description: description.to_string(),
        internal_error: anyhow::Error::new(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inbound::toolset::types::ToolThreadSummary;

    fn dt(seconds: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(seconds, 0).unwrap()
    }

    fn message(id: Uuid, created_at: DateTime<Utc>) -> ToolChannelMessage {
        ToolChannelMessage {
            id,
            channel_id: Uuid::new_v4(),
            sender_id: "macro|sender@example.com".to_string(),
            content: "hello".to_string(),
            content_truncated: false,
            created_at,
            updated_at: created_at,
            edited_at: None,
            deleted_at: None,
            thread: ToolThreadSummary {
                thread_id: id,
                reply_count: 0,
                latest_reply_at: None,
                preview: None,
                omitted_reply_count: 0,
            },
            reactions: Vec::new(),
            attachments: Vec::new(),
        }
    }

    #[test]
    fn cursor_round_trip_preserves_filters() {
        let message_id = Uuid::new_v4();
        let requested_message_id = Uuid::new_v4();
        let filter = ChannelMessagesCursorFilter {
            message_ids: vec![requested_message_id],
            created_after: None,
            created_before: None,
            activity_after: Some(dt(10)),
            activity_before: Some(dt(20)),
        };
        let cursor = cursor_from_newest_message(&[message(message_id, dt(15))], 25, filter)
            .expect("message should produce cursor");

        let decoded = decode_channel_cursor(&cursor).expect("cursor should decode");

        assert_eq!(decoded.id, message_id);
        assert_eq!(decoded.val.last_val, dt(15));
        assert_eq!(decoded.filter.message_ids, vec![requested_message_id]);
        assert_eq!(decoded.filter.activity_after, Some(dt(10)));
        assert_eq!(decoded.filter.activity_before, Some(dt(20)));
    }
}
