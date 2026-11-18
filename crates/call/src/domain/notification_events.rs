//! Public call facts published for access-checked webhook subscribers.

#[cfg(test)]
mod test;

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroCallNotificationsTopic;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Identifiers and actors for a public call notification. Optional fields are
/// absent when they do not apply to the event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CallNotificationMetadata {
    /// Call identifier.
    pub call_id: Uuid,
    /// Channel containing the call, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<Uuid>,
    /// Meeting associated with an invitation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meeting_id: Option<Uuid>,
    /// User who created the call.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by: Option<String>,
    /// Room identity of the joining or departing participant.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity: Option<String>,
    /// Account identifier of the participant or answering user.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    /// User who sent an invitation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invited_by: Option<String>,
    /// Intended recipient of a private event. Removed before delivery.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "inbound", schema(ignore))]
    pub recipient_user_id: Option<String>,
}

impl CallNotificationMetadata {
    /// Begin metadata for a call; add event-specific fields before publishing.
    pub fn new(call_id: Uuid, channel_id: Option<Uuid>) -> Self {
        Self {
            call_id,
            channel_id,
            meeting_id: None,
            created_by: None,
            identity: None,
            user_id: None,
            invited_by: None,
            recipient_user_id: None,
        }
    }
}

/// Public call events. Private variants carry a recipient on the broker only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum CallNotificationEvent {
    /// A call started.
    #[serde(rename = "call.started")]
    Started(CallNotificationMetadata),
    /// A call ended.
    #[serde(rename = "call.ended")]
    Ended(CallNotificationMetadata),
    /// A participant entered the RTC room.
    #[serde(rename = "call.participant_joined")]
    ParticipantJoined(CallNotificationMetadata),
    /// A participant left the RTC room.
    #[serde(rename = "call.participant_left")]
    ParticipantLeft(CallNotificationMetadata),
    /// A recording became available.
    #[serde(rename = "call.recording_ready")]
    RecordingReady(CallNotificationMetadata),
    /// A summary became available.
    #[serde(rename = "call.summarized")]
    Summarized(CallNotificationMetadata),
    /// The recipient is being rung.
    #[serde(rename = "call.ringing")]
    Ringing(CallNotificationMetadata),
    /// The recipient answered.
    #[serde(rename = "call.answered")]
    Answered(CallNotificationMetadata),
    /// The recipient declined.
    #[serde(rename = "call.declined")]
    Declined(CallNotificationMetadata),
    /// The recipient was invited.
    #[serde(rename = "call.invited")]
    Invited(CallNotificationMetadata),
}

impl CallNotificationEvent {
    /// Metadata shared by all variants.
    pub fn metadata(&self) -> &CallNotificationMetadata {
        match self {
            Self::Started(m)
            | Self::Ended(m)
            | Self::ParticipantJoined(m)
            | Self::ParticipantLeft(m)
            | Self::RecordingReady(m)
            | Self::Summarized(m)
            | Self::Ringing(m)
            | Self::Answered(m)
            | Self::Declined(m)
            | Self::Invited(m) => m,
        }
    }

    /// Public event name.
    pub fn name(&self) -> &'static str {
        match self {
            Self::Started(_) => "call.started",
            Self::Ended(_) => "call.ended",
            Self::ParticipantJoined(_) => "call.participant_joined",
            Self::ParticipantLeft(_) => "call.participant_left",
            Self::RecordingReady(_) => "call.recording_ready",
            Self::Summarized(_) => "call.summarized",
            Self::Ringing(_) => "call.ringing",
            Self::Answered(_) => "call.answered",
            Self::Declined(_) => "call.declined",
            Self::Invited(_) => "call.invited",
        }
    }
}

impl TopicEvent for CallNotificationEvent {
    type Topic = MacroCallNotificationsTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable notification keyed by call ID.
pub struct CallNotificationMacroEvent {
    key: String,
    event: Event<CallNotificationEvent>,
}

impl CallNotificationMacroEvent {
    /// Wrap a call notification in a broker envelope.
    pub fn new(event: CallNotificationEvent) -> Self {
        let key = event.metadata().call_id.to_string();
        Self {
            key,
            event: Event::new(event),
        }
    }
}

impl MacroEvent for CallNotificationMacroEvent {
    type EventPayload = CallNotificationEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self { key, event }
    }
}
