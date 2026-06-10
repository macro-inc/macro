//! Shared channel AI tool input/output types.

use crate::domain::models::{
    ChannelMessage, ChannelMessageKind, CountedReaction, MessageAttachment, ResolvedChannelMessage,
    ThreadReply,
};
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Default number of messages/replies returned by channel AI tools.
pub(crate) const DEFAULT_LIMIT: u16 = 25;
/// Maximum number of messages/replies returned by channel AI tools.
pub(crate) const MAX_LIMIT: u16 = 100;
/// Default maximum content length per message.
pub(crate) const DEFAULT_MAX_CHARS_PER_MESSAGE: usize = 4_000;
/// Maximum allowed content length per message.
pub(crate) const MAX_CHARS_PER_MESSAGE: usize = 16_000;

/// Direction for reading more messages around a cursor.
#[allow(missing_docs)]
#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PageDirection {
    Older,
    Newer,
}

/// Position of a channel message.
#[derive(Debug, Clone, Copy, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ToolMessageKind {
    /// A top-level message in the channel timeline.
    TopLevelMessage,
    /// A reply inside a top-level message's thread.
    ThreadReply,
}

impl From<ChannelMessageKind> for ToolMessageKind {
    fn from(kind: ChannelMessageKind) -> Self {
        match kind {
            ChannelMessageKind::TopLevelMessage => Self::TopLevelMessage,
            ChannelMessageKind::ThreadReply => Self::ThreadReply,
        }
    }
}

/// A reaction summary on a message.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolReaction {
    /// Emoji that was reacted with.
    pub emoji: String,
    /// User ids that reacted with this emoji.
    pub users: Vec<String>,
}

impl From<CountedReaction> for ToolReaction {
    fn from(reaction: CountedReaction) -> Self {
        Self {
            emoji: reaction.emoji,
            users: reaction.users,
        }
    }
}

/// A compact attachment reference on a message.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolAttachment {
    /// Attachment id.
    pub id: Uuid,
    /// Attached entity type.
    pub entity_type: String,
    /// Attached entity id.
    pub entity_id: String,
    /// When the attachment was created.
    pub created_at: DateTime<Utc>,
}

impl From<MessageAttachment> for ToolAttachment {
    fn from(attachment: MessageAttachment) -> Self {
        Self {
            id: attachment.id,
            entity_type: attachment.entity_type,
            entity_id: attachment.entity_id,
            created_at: attachment.created_at,
        }
    }
}

/// A compact thread reply returned by channel AI tools.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolThreadReply {
    /// Reply message id.
    pub id: Uuid,
    /// Parent thread id.
    pub thread_id: Uuid,
    /// Sender user id.
    pub sender_id: String,
    /// Reply content, possibly truncated.
    pub content: String,
    /// Whether the reply content was truncated.
    pub content_truncated: bool,
    /// When the reply was created.
    pub created_at: DateTime<Utc>,
    /// When the reply was last updated.
    pub updated_at: DateTime<Utc>,
    /// When the reply was edited, if ever.
    pub edited_at: Option<DateTime<Utc>>,
    /// Reactions on this reply.
    pub reactions: Vec<ToolReaction>,
    /// Attachments on this reply.
    pub attachments: Vec<ToolAttachment>,
}

impl ToolThreadReply {
    pub(crate) fn from_reply(
        reply: ThreadReply,
        thread_id: Uuid,
        max_chars_per_message: usize,
    ) -> Self {
        let TruncatedContent {
            content,
            content_truncated,
        } = truncate_content(reply.content, max_chars_per_message);

        Self {
            id: reply.id,
            thread_id,
            sender_id: reply.sender_id,
            content,
            content_truncated,
            created_at: reply.created_at,
            updated_at: reply.updated_at,
            edited_at: reply.edited_at,
            reactions: reply
                .reactions
                .into_iter()
                .map(ToolReaction::from)
                .collect(),
            attachments: reply
                .attachments
                .into_iter()
                .map(ToolAttachment::from)
                .collect(),
        }
    }
}

/// Thread metadata attached to a top-level message.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolThreadSummary {
    /// Parent thread id. This equals the top-level message id.
    pub thread_id: Uuid,
    /// Total number of replies in the thread.
    pub reply_count: i64,
    /// Timestamp of the latest reply, if any.
    pub latest_reply_at: Option<DateTime<Utc>>,
    /// Preview replies, when requested.
    pub preview: Option<Vec<ToolThreadReply>>,
    /// Reply count not included in `preview`.
    pub omitted_reply_count: i64,
}

/// A compact top-level channel message returned by channel AI tools.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolChannelMessage {
    /// Message id.
    pub id: Uuid,
    /// Channel id.
    pub channel_id: Uuid,
    /// Sender user id.
    pub sender_id: String,
    /// Message content, possibly truncated.
    pub content: String,
    /// Whether message content was truncated.
    pub content_truncated: bool,
    /// When the message was created.
    pub created_at: DateTime<Utc>,
    /// When the message was last updated.
    pub updated_at: DateTime<Utc>,
    /// When the message was edited, if ever.
    pub edited_at: Option<DateTime<Utc>>,
    /// When the message was deleted, if ever.
    pub deleted_at: Option<DateTime<Utc>>,
    /// Thread metadata for this message.
    pub thread: ToolThreadSummary,
    /// Reactions on this message.
    pub reactions: Vec<ToolReaction>,
    /// Attachments on this message.
    pub attachments: Vec<ToolAttachment>,
}

impl ToolChannelMessage {
    pub(crate) fn from_message(
        message: ChannelMessage,
        include_thread_preview: bool,
        max_chars_per_message: usize,
    ) -> Self {
        let thread_id = message.id;
        let TruncatedContent {
            content,
            content_truncated,
        } = truncate_content(message.content, max_chars_per_message);
        let preview_replies = message.thread.preview;
        let preview_len = if include_thread_preview {
            preview_replies.len() as i64
        } else {
            0
        };
        let preview = include_thread_preview.then(|| {
            preview_replies
                .into_iter()
                .map(|reply| ToolThreadReply::from_reply(reply, thread_id, max_chars_per_message))
                .collect()
        });

        Self {
            id: message.id,
            channel_id: message.channel_id,
            sender_id: message.sender_id,
            content,
            content_truncated,
            created_at: message.created_at,
            updated_at: message.updated_at,
            edited_at: message.edited_at,
            deleted_at: message.deleted_at,
            thread: ToolThreadSummary {
                thread_id,
                reply_count: message.thread.reply_count,
                latest_reply_at: message.thread.latest_reply_at,
                preview,
                omitted_reply_count: (message.thread.reply_count - preview_len).max(0),
            },
            reactions: message
                .reactions
                .into_iter()
                .map(ToolReaction::from)
                .collect(),
            attachments: message
                .attachments
                .into_iter()
                .map(ToolAttachment::from)
                .collect(),
        }
    }
}

/// Resolution details for a requested message id.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolResolvedMessage {
    /// Requested message id.
    pub message_id: Uuid,
    /// Channel id.
    pub channel_id: Uuid,
    /// Whether the message is top-level or a thread reply.
    pub kind: ToolMessageKind,
    /// Parent thread id. Equals `message_id` for top-level messages.
    pub thread_id: Uuid,
    /// When the requested message was created.
    pub created_at: DateTime<Utc>,
}

impl From<ResolvedChannelMessage> for ToolResolvedMessage {
    fn from(message: ResolvedChannelMessage) -> Self {
        Self {
            message_id: message.message_id,
            channel_id: message.channel_id,
            kind: ToolMessageKind::from(message.kind),
            thread_id: message.thread_id,
            created_at: message.created_at,
        }
    }
}

/// Navigation cursors and continuation hints for a bounded result.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolNavigation {
    /// Cursor for reading older items, if available.
    pub older_cursor: Option<String>,
    /// Cursor for reading newer items, if available.
    pub newer_cursor: Option<String>,
    /// Whether an older cursor was returned.
    pub has_more_older: bool,
    /// Whether newer messages are known to exist.
    pub has_more_newer: bool,
}

/// Kind of content omitted from a bounded tool response.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ToolOmissionKind {
    /// Older channel messages exist outside the returned window.
    OlderMessages,
    /// Newer channel messages exist outside the returned window.
    NewerMessages,
    /// Thread replies were omitted.
    ThreadReplies,
    /// Message content was truncated.
    TruncatedContent,
}

/// Information about content omitted from a tool response.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolOmission {
    /// Omission category.
    pub kind: ToolOmissionKind,
    /// Message id associated with the omission, when applicable.
    pub message_id: Option<Uuid>,
    /// Thread id associated with the omission, when applicable.
    pub thread_id: Option<Uuid>,
    /// Number of omitted items, when known.
    pub count: Option<i64>,
    /// Cursor that can be used to continue reading, when available.
    pub cursor: Option<String>,
}

struct TruncatedContent {
    content: String,
    content_truncated: bool,
}

pub(crate) fn clamp_limit(limit: Option<u16>) -> u16 {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

pub(crate) fn clamp_max_chars(max_chars_per_message: Option<usize>) -> usize {
    max_chars_per_message
        .unwrap_or(DEFAULT_MAX_CHARS_PER_MESSAGE)
        .clamp(1, MAX_CHARS_PER_MESSAGE)
}

fn truncate_content(content: String, max_chars: usize) -> TruncatedContent {
    let mut chars = content.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    let content_truncated = chars.next().is_some();

    TruncatedContent {
        content: truncated,
        content_truncated,
    }
}

pub(crate) fn content_truncation_omissions(
    messages: &[ToolChannelMessage],
    replies: &[ToolThreadReply],
) -> Vec<ToolOmission> {
    let mut omissions = Vec::new();
    for message in messages {
        if message.content_truncated {
            omissions.push(ToolOmission {
                kind: ToolOmissionKind::TruncatedContent,
                message_id: Some(message.id),
                thread_id: None,
                count: None,
                cursor: None,
            });
        }
        for reply in message.thread.preview.iter().flatten() {
            if reply.content_truncated {
                omissions.push(ToolOmission {
                    kind: ToolOmissionKind::TruncatedContent,
                    message_id: Some(reply.id),
                    thread_id: Some(reply.thread_id),
                    count: None,
                    cursor: None,
                });
            }
        }
    }
    for reply in replies {
        if reply.content_truncated {
            omissions.push(ToolOmission {
                kind: ToolOmissionKind::TruncatedContent,
                message_id: Some(reply.id),
                thread_id: Some(reply.thread_id),
                count: None,
                cursor: None,
            });
        }
    }
    omissions
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::models::ThreadInfo;

    fn dt(seconds: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(seconds, 0).unwrap()
    }

    fn reply(seconds: i64) -> ThreadReply {
        ThreadReply {
            id: Uuid::new_v4(),
            sender_id: "macro|reply@example.com".to_string(),
            bot_profile: None,
            content: "reply".to_string(),
            created_at: dt(seconds),
            updated_at: dt(seconds),
            edited_at: None,
            reactions: Vec::new(),
            attachments: Vec::new(),
        }
    }

    fn message_with_thread(reply_count: i64, preview: Vec<ThreadReply>) -> ChannelMessage {
        let id = Uuid::new_v4();
        ChannelMessage {
            id,
            channel_id: Uuid::new_v4(),
            sender_id: "macro|sender@example.com".to_string(),
            bot_profile: None,
            content: "parent".to_string(),
            created_at: dt(1),
            updated_at: dt(1),
            edited_at: None,
            deleted_at: None,
            thread: ThreadInfo {
                reply_count,
                latest_reply_at: None,
                preview,
            },
            reactions: Vec::new(),
            attachments: Vec::new(),
        }
    }

    #[test]
    fn omitted_reply_count_includes_hidden_previews_when_preview_is_disabled() {
        let message = message_with_thread(5, vec![reply(2), reply(3), reply(4)]);

        let tool_message = ToolChannelMessage::from_message(message, false, 4_000);

        assert!(tool_message.thread.preview.is_none());
        assert_eq!(tool_message.thread.omitted_reply_count, 5);
    }

    #[test]
    fn omitted_reply_count_excludes_included_previews_when_preview_is_enabled() {
        let message = message_with_thread(5, vec![reply(2), reply(3), reply(4)]);

        let tool_message = ToolChannelMessage::from_message(message, true, 4_000);

        assert_eq!(tool_message.thread.preview.as_ref().unwrap().len(), 3);
        assert_eq!(tool_message.thread.omitted_reply_count, 2);
    }
}
