//! Root conversation metadata and individual message/event records.
//!
//! Deserialize each root file as `Vec<ExportConversation>` and each day file as
//! `Vec<ExportRecord>`, or decode NDJSON one record at a time. Unknown fields
//! (including attachments, files, blocks and `replies[]`) are discarded.

use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, de};

use crate::domain::models::{
    ConversationId, ConversationKind, ConversationMetadata, KeySegment, SlackTimestamp,
    SlackUserId, ValidationError,
};

use super::{threads::MessageIdentity, users::UserProfile};

#[cfg(test)]
mod test;

/// Supported root conversation lists; filename, not ID prefix, determines kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConversationFile {
    /// Public Slack channels, mapped to Macro Team channels.
    Channels,
    /// Private Slack channels.
    Groups,
    /// Two-person direct messages.
    DirectMessages,
    /// Group direct messages.
    GroupDirectMessages,
}

impl FromStr for ConversationFile {
    type Err = ValidationError;

    fn from_str(name: &str) -> Result<Self, Self::Err> {
        match name {
            "channels.json" => Ok(Self::Channels),
            "groups.json" => Ok(Self::Groups),
            "dms.json" => Ok(Self::DirectMessages),
            "mpims.json" => Ok(Self::GroupDirectMessages),
            _ => Err(ValidationError::InvalidId),
        }
    }
}

impl ConversationFile {
    /// Domain mapping, never globally Public.
    pub fn kind(self) -> ConversationKind {
        match self {
            Self::Channels => ConversationKind::PublicChannel,
            Self::Groups => ConversationKind::PrivateChannel,
            Self::DirectMessages => ConversationKind::DirectMessage,
            Self::GroupDirectMessages => ConversationKind::GroupDirectMessage,
        }
    }
}

/// One entry from channels.json, groups.json, dms.json or mpims.json.
#[derive(Debug, Clone, Deserialize)]
pub struct ExportConversation {
    /// Source identity; prefix alone does not determine visibility.
    pub id: ConversationId,
    /// DMs need not have a name.
    pub name: Option<String>,
    /// Full source membership, including unknown users.
    #[serde(default)]
    pub members: Vec<SlackUserId>,
    /// Optional source creator.
    pub creator: Option<SlackUserId>,
    /// Integer seconds or exact string timestamp; missing stays missing.
    #[serde(default, deserialize_with = "creation_time")]
    pub created: Option<SlackTimestamp>,
    /// Source archival flag.
    #[serde(default)]
    pub is_archived: bool,
}

impl ExportConversation {
    /// Build persisted metadata using the folder found by the archive indexer.
    /// Folder discovery stays separate: display names are not trusted paths, and
    /// DM/export variants need not use the same folder naming convention.
    pub fn into_metadata(self, file: ConversationFile, folder: KeySegment) -> ConversationMetadata {
        ConversationMetadata {
            name: self.name.unwrap_or_else(|| self.id.to_string()),
            slack_channel_id: self.id,
            kind: file.kind(),
            folder,
            member_ids: self.members,
            creator_id: self.creator,
            created_at: self.created,
            archived: self.is_archived,
            message_count: None,
        }
    }
}

fn creation_time<'de, D>(deserializer: D) -> Result<Option<SlackTimestamp>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Time {
        Seconds(u64),
        Text(String),
    }

    let Some(value) = Option::<Time>::deserialize(deserializer)? else {
        return Ok(None);
    };
    let text = match value {
        Time::Seconds(seconds) => format!("{seconds}.000000"),
        Time::Text(text) if text.contains('.') => text,
        Time::Text(text) => format!("{text}.000000"),
    };
    text.parse().map(Some).map_err(de::Error::custom)
}

/// Source reaction, before shortcode conversion and email-based actor dedupe.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct ExportReaction {
    /// Slack shortcode (possibly custom/unsupported).
    pub name: String,
    /// Actor list is authoritative, not the advisory `count` field.
    #[serde(default)]
    pub users: Vec<SlackUserId>,
    /// Optional exact reaction time; standard archives omit it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ts: Option<SlackTimestamp>,
}

/// Message content retained for author, mrkdwn and reaction conversion.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct MessageContent {
    /// Unknown subtypes remain available to the converter.
    pub subtype: Option<String>,
    /// Empty/missing text is allowed; the converter decides whether to skip it.
    #[serde(default)]
    pub text: String,
    /// Slack Connect, phantom and missing-directory users are valid source IDs.
    pub user: Option<SlackUserId>,
    /// Per-message profile, useful when the root directory is incomplete.
    pub user_profile: Option<UserProfile>,
    /// Legacy bot display name.
    pub username: Option<String>,
    /// Newer bot profile display name.
    pub bot_profile: Option<BotProfile>,
    /// Reaction records; attachment/file/blocks fields are deliberately ignored.
    #[serde(default)]
    pub reactions: Vec<ExportReaction>,
}

/// Minimal bot profile; no bot identity is mapped to a human email.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct BotProfile {
    /// Source display name.
    pub name: Option<String>,
}

/// Message-shaped portion of a record. Event wrappers need not have a timestamp.
#[derive(Debug, Clone, Deserialize)]
pub struct ExportMessage {
    /// Record type; absent is accepted for nested edited message snapshots.
    #[serde(rename = "type")]
    pub record_type: Option<String>,
    /// Original message timestamp, never the edit-event timestamp.
    pub ts: Option<SlackTimestamp>,
    /// Thread root identity; `replies[]` is intentionally not retained.
    pub thread_ts: Option<SlackTimestamp>,
    /// Fields used by subsequent conversion.
    #[serde(flatten)]
    pub content: MessageContent,
}

/// A day-file or NDJSON record, including Slack's `message_changed` wrapper.
#[derive(Debug, Clone, Deserialize)]
pub struct ExportRecord {
    /// Outer event/message fields.
    #[serde(flatten)]
    pub outer: ExportMessage,
    /// Current snapshot for an edit; previous_message is deliberately ignored.
    pub message: Option<ExportMessage>,
}

/// Why a record intentionally does not produce an importable message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkippedRecord {
    /// Not a message event.
    NonMessage,
    /// Deletion event; v1 never deletes an already imported Macro message.
    Deleted,
    /// Tombstone has no importable body; v1 does not propagate deletions.
    Tombstone,
}

/// Normalization outcome, separate from later text/housekeeping filtering.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NormalizedRecord {
    /// Ordinary message or the current snapshot of an edit event.
    Message(Box<NormalizedMessage>),
    /// Deliberately ignored source event.
    Skipped(SkippedRecord),
}

/// Exact message identity plus content; independent of day-file boundaries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedMessage {
    /// Source conversation and exact original time.
    pub identity: MessageIdentity,
    /// Root timestamp, including the self-reference present on some roots.
    pub thread_ts: Option<SlackTimestamp>,
    /// Current text/author/reactions, ready for conversion.
    pub content: MessageContent,
}

impl ExportRecord {
    /// Normalize an edit using its inner message's identity, not event_ts/outer ts.
    /// Unknown subtypes are preserved. Missing message timestamps fail explicitly.
    /// Deletions/tombstones are skipped only: they do not mutate earlier records
    /// or durable mappings. Across jobs the first committed source identity wins;
    /// this parser is not an edit/delete synchronization engine.
    pub fn normalize(
        self,
        conversation: ConversationId,
    ) -> Result<NormalizedRecord, ValidationError> {
        let mut message = self.outer;
        if message
            .record_type
            .as_deref()
            .is_some_and(|t| t != "message")
        {
            return Ok(NormalizedRecord::Skipped(SkippedRecord::NonMessage));
        }
        if message.content.subtype.as_deref() == Some("message_changed") {
            message = self.message.ok_or(ValidationError::InvalidTimestamp)?;
        }
        let skip = match message.content.subtype.as_deref() {
            Some("message_deleted") => Some(SkippedRecord::Deleted),
            Some("tombstone") => Some(SkippedRecord::Tombstone),
            _ => None,
        };
        if let Some(reason) = skip {
            return Ok(NormalizedRecord::Skipped(reason));
        }
        Ok(NormalizedRecord::Message(Box::new(NormalizedMessage {
            identity: MessageIdentity {
                conversation,
                ts: message.ts.ok_or(ValidationError::InvalidTimestamp)?,
            },
            thread_ts: message.thread_ts,
            content: message.content,
        })))
    }
}
