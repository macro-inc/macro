//! Kafka event models for the `macro.calls` topic.
//!
//! Event payloads deliberately exclude transcript and summary text, recording
//! locations, and share-permission objects. Consumers can fetch protected call
//! content through authorized APIs using the published identifiers.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroCallsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Metadata for [`CallTopicEvent::Started`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallStartedMetadata {
    /// Identifier of the started call.
    pub call_id: Uuid,
    /// Identifier of the channel containing the call.
    pub channel_id: Uuid,
    /// User who created the call.
    pub created_by: MacroUserIdStr<'static>,
    /// Time at which the call was created.
    pub created_at: DateTime<Utc>,
    /// Whether recording was enabled when the call started.
    pub recording_enabled: bool,
}

/// Reason an active call was archived as a call record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallArchiveReason {
    /// The final participant left the call.
    LastParticipantLeft,
    /// The room-finished webhook archived the call.
    RoomFinished,
}

/// Metadata for [`CallTopicEvent::RecordArchived`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallRecordArchivedMetadata {
    /// Identifier shared by the active call and archived call record.
    pub call_id: Uuid,
    /// Identifier of the channel containing the call record.
    pub channel_id: Uuid,
    /// User who created the call.
    pub created_by: MacroUserIdStr<'static>,
    /// Time at which the call started.
    pub started_at: DateTime<Utc>,
    /// Time at which the call was archived.
    pub ended_at: DateTime<Utc>,
    /// Call duration in milliseconds, when available.
    pub duration_ms: Option<i64>,
    /// Number of distinct participants over the call's lifetime.
    pub participant_count: usize,
    /// Whether the call has an associated recording.
    pub has_recording: bool,
    /// Reason the call was archived.
    pub archive_reason: CallArchiveReason,
}

/// Metadata for [`CallTopicEvent::RecordUpdated`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallRecordUpdatedMetadata {
    /// Identifier of the updated call record.
    pub call_id: Uuid,
    /// Identifier of the channel containing the call record.
    pub channel_id: Uuid,
    /// User who updated the record, or `None` for an internal caller.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// New custom display name, or `None` when unchanged.
    pub custom_name: Option<String>,
    /// New team-sharing value, or `None` when unchanged.
    pub share_with_team: Option<bool>,
}

/// Metadata for [`CallTopicEvent::RecordDeleted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallRecordDeletedMetadata {
    /// Identifier of the deleted call record.
    pub call_id: Uuid,
    /// Identifier of the channel that contained the call record.
    pub channel_id: Uuid,
    /// User who deleted the record, or `None` for an internal caller.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
}

/// Metadata for [`CallTopicEvent::RecordSummarized`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallRecordSummarizedMetadata {
    /// Identifier of the summarized call record.
    pub call_id: Uuid,
    /// Identifier of the channel containing the call record.
    pub channel_id: Uuid,
    /// Whether an AI-generated display name was persisted with the summary.
    pub ai_name_generated: bool,
}

/// Metadata for [`CallTopicEvent::RecordingReady`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallRecordingReadyMetadata {
    /// Identifier of the call record whose recording is ready.
    pub call_id: Uuid,
    /// Identifier of the channel containing the call record.
    pub channel_id: Uuid,
}

/// Lifecycle and recording events published to [`MacroCallsTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum CallTopicEvent {
    /// A call was started.
    #[serde(rename = "call.started")]
    Started(CallStartedMetadata),
    /// An active call was archived as a call record.
    #[serde(rename = "call.record_archived")]
    RecordArchived(CallRecordArchivedMetadata),
    /// A call record's metadata was updated.
    #[serde(rename = "call.record_updated")]
    RecordUpdated(CallRecordUpdatedMetadata),
    /// A call record was deleted.
    #[serde(rename = "call.record_deleted")]
    RecordDeleted(CallRecordDeletedMetadata),
    /// A summary was persisted for a call record.
    #[serde(rename = "call.record_summarized")]
    RecordSummarized(CallRecordSummarizedMetadata),
    /// A call record's recording became available.
    #[serde(rename = "call.recording_ready")]
    RecordingReady(CallRecordingReadyMetadata),
}

impl TopicEvent for CallTopicEvent {
    type Topic = MacroCallsTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable event for [`MacroCallsTopic`], keyed by the call's bare id.
pub struct CallMacroEvent {
    key: String,
    event: Event<CallTopicEvent>,
}

impl CallMacroEvent {
    /// Build a call-started event keyed by the call id.
    pub fn started(metadata: CallStartedMetadata) -> Self {
        let key = metadata.call_id.to_string();
        Self::new(key, CallTopicEvent::Started(metadata))
    }

    /// Build a record-archived event keyed by the call id.
    pub fn record_archived(metadata: CallRecordArchivedMetadata) -> Self {
        let key = metadata.call_id.to_string();
        Self::new(key, CallTopicEvent::RecordArchived(metadata))
    }

    /// Build a record-updated event keyed by the call id.
    pub fn record_updated(metadata: CallRecordUpdatedMetadata) -> Self {
        let key = metadata.call_id.to_string();
        Self::new(key, CallTopicEvent::RecordUpdated(metadata))
    }

    /// Build a record-deleted event keyed by the call id.
    pub fn record_deleted(metadata: CallRecordDeletedMetadata) -> Self {
        let key = metadata.call_id.to_string();
        Self::new(key, CallTopicEvent::RecordDeleted(metadata))
    }

    /// Build a record-summarized event keyed by the call id.
    pub fn record_summarized(metadata: CallRecordSummarizedMetadata) -> Self {
        let key = metadata.call_id.to_string();
        Self::new(key, CallTopicEvent::RecordSummarized(metadata))
    }

    /// Build a recording-ready event keyed by the call id.
    pub fn recording_ready(metadata: CallRecordingReadyMetadata) -> Self {
        let key = metadata.call_id.to_string();
        Self::new(key, CallTopicEvent::RecordingReady(metadata))
    }

    fn new(key: String, event: CallTopicEvent) -> Self {
        Self::with_event(key, Event::new(event))
    }

    fn with_event(key: String, event: Event<CallTopicEvent>) -> Self {
        Self { key, event }
    }
}

impl MacroEvent for CallMacroEvent {
    type EventPayload = CallTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self::with_event(key, event)
    }
}
