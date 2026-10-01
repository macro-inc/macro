//! Bounded, trusted historical channel writes, separate from live message commands.

use std::collections::HashSet;

use channel_sender::ChannelSender;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Serialize;
use uuid::Uuid;

use super::ports::MessageError;

/// Maximum messages in one historical transaction batch.
pub const MAX_HISTORICAL_MESSAGES: usize = 500;
/// Maximum summed serialized message bytes per batch, including references and metadata.
pub const MAX_HISTORICAL_BATCH_BYTES: usize = 4 * 1024 * 1024;
/// Maximum serialized input bytes for one message, including references and metadata.
pub const MAX_HISTORICAL_MESSAGE_BYTES: usize = 1024 * 1024;

/// Live persisted channel message identity, without body or author disclosure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoricalMessageTarget {
    /// Actual message ID.
    pub message_id: Uuid,
    /// Actual owning channel, checked against parent ownership.
    pub channel_id: Uuid,
    /// Persisted live root (self for roots and orphan-imported replies).
    pub root_id: Uuid,
}

/// A channel already authorized by the importing domain and its bounded messages.
/// Source deduplication, fencing, mappings and checkpoints belong to the caller.
#[derive(Debug, Clone, Serialize)]
pub struct HistoricalBatch {
    /// Authorized channel; all thread roots must belong to this channel.
    pub channel_id: Uuid,
    /// New messages only. A conflicting message ID rejects the entire batch.
    pub messages: Vec<HistoricalMessage>,
}

/// Caller-attributed historical content. No live-message effects are requested.
#[derive(Debug, Clone, Serialize)]
pub struct HistoricalMessage {
    /// Caller-generated UUIDv7, also used by the caller's durable source mapping.
    pub id: Uuid,
    /// Root in this batch or a previously committed batch; never another reply.
    pub thread_id: Option<Uuid>,
    /// Original author, or the system bot for an unmapped author.
    pub sender: ChannelSender<'static>,
    /// Display attribution for imported authors without a Macro identity.
    pub imported_author: Option<String>,
    /// Nonempty converted Markdown; attachment bytes are not accepted.
    pub content: String,
    /// Original creation time, with at most microsecond precision.
    pub created_at: DateTime<Utc>,
    /// Historical update time, not the time of import.
    pub updated_at: DateTime<Utc>,
    /// Original edit time, if supplied.
    pub edited_at: Option<DateTime<Utc>>,
    /// Source-owned provenance, including orphan-thread identity when applicable.
    pub import_metadata: serde_json::Value,
    /// Nonnegative source ordering, retained across batch boundaries.
    pub import_order: i64,
    /// Historical reactions; duplicate natural keys are ignored, never updated.
    pub reactions: Vec<HistoricalReaction>,
    /// User-only mentions; these do not share entities or notify recipients.
    pub mentions: Vec<HistoricalUserMention>,
}

/// A historical reaction uses its existing natural key, not a surrogate ID.
#[derive(Debug, Clone, Serialize)]
pub struct HistoricalReaction {
    /// Mapped human identity; no roster membership is required.
    pub user_id: MacroUserIdStr<'static>,
    /// Converted Unicode reaction, bounded by the database's 32-character limit.
    pub emoji: String,
    /// Original reaction time, or source message time when absent.
    pub created_at: DateTime<Utc>,
}

/// A user mention stored without invoking live reference or sharing services.
#[derive(Debug, Clone, Serialize)]
pub struct HistoricalUserMention {
    /// Caller-generated UUIDv7.
    pub id: Uuid,
    /// Mentioned human identity.
    pub user_id: MacroUserIdStr<'static>,
}

impl HistoricalBatch {
    /// Validate input bounds without allocating SQL arrays or a serialized copy.
    /// Database-dependent thread ownership is checked by the persistence adapter.
    pub fn validate(&self) -> Result<(), MessageError> {
        if self.channel_id.is_nil() || self.messages.len() > MAX_HISTORICAL_MESSAGES {
            return Err(MessageError::Invalid(
                "invalid historical batch size or channel",
            ));
        }
        let mut ids = HashSet::new();
        let mut bytes = 0;
        for message in &self.messages {
            let mut size = MessageSize(0);
            serde_json::to_writer(&mut size, message)
                .map_err(|_| MessageError::Invalid("historical message exceeds byte limit"))?;
            bytes += size.0;
            if bytes > MAX_HISTORICAL_BATCH_BYTES {
                return Err(MessageError::Invalid("historical batch exceeds byte limit"));
            }
            if !is_uuid_v7(message.id) || !ids.insert(message.id) {
                return Err(MessageError::Invalid(
                    "historical message IDs must be unique UUIDv7s",
                ));
            }
            if message.thread_id == Some(message.id)
                || message.content.trim().is_empty()
                || message.import_order < 0
                || message
                    .imported_author
                    .as_ref()
                    .is_some_and(|name| name.trim().is_empty())
            {
                return Err(MessageError::Invalid("invalid historical message"));
            }
            validate_timestamp(message.created_at)?;
            validate_timestamp(message.updated_at)?;
            if message.updated_at < message.created_at {
                return Err(MessageError::Invalid("historical update precedes creation"));
            }
            if let Some(edited_at) = message.edited_at {
                validate_timestamp(edited_at)?;
                if edited_at < message.created_at || edited_at > message.updated_at {
                    return Err(MessageError::Invalid(
                        "historical edit outside message lifetime",
                    ));
                }
            }
            for reaction in &message.reactions {
                validate_timestamp(reaction.created_at)?;
                if reaction.emoji.trim().is_empty() || reaction.emoji.chars().count() > 32 {
                    return Err(MessageError::Invalid("invalid historical reaction"));
                }
            }
            for mention in &message.mentions {
                if !is_uuid_v7(mention.id) || !ids.insert(mention.id) {
                    return Err(MessageError::Invalid(
                        "historical mention IDs must be unique UUIDv7s",
                    ));
                }
            }
        }
        Ok(())
    }
}

// Count encoded bytes without allocating another copy of untrusted content.
struct MessageSize(usize);

impl std::io::Write for MessageSize {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > MAX_HISTORICAL_MESSAGE_BYTES - self.0 {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
        self.0 += bytes.len();
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn is_uuid_v7(id: Uuid) -> bool {
    id.get_variant() == uuid::Variant::RFC4122 && id.get_version() == Some(uuid::Version::SortRand)
}

fn validate_timestamp(timestamp: DateTime<Utc>) -> Result<(), MessageError> {
    // Same interoperable range as import source timestamps: epoch through year 9999.
    if !(0..=253_402_300_799).contains(&timestamp.timestamp())
        || timestamp.timestamp_subsec_nanos() >= 1_000_000_000
        || !timestamp.timestamp_subsec_nanos().is_multiple_of(1000)
    {
        return Err(MessageError::Invalid("invalid historical timestamp"));
    }
    Ok(())
}
