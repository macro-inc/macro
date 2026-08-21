//! Kafka event models for the `macro.calendar` topic.

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroCalendarTopic;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Metadata carried by every calendar topic event.
///
/// The same shape for all three variants: the variant says what happened, and
/// the owner lets a consumer route or filter without a database read.
/// Everything else about the event is re-read from the row — except on
/// [`CalendarTopicEvent::Deleted`], where there is no row left to read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CalendarEventMetadata {
    /// The event entity this change concerns.
    pub event_id: Uuid,
    /// Owner of this per-user event projection.
    pub owner_id: String,
}

/// Calendar events published to [`MacroCalendarTopic`].
///
/// The variants report what happened to the canonical `calendar_events` row,
/// not what a caller asked for: an idempotent re-create that lands on the
/// upsert's conflict path is an [`Updated`](CalendarTopicEvent::Updated), and
/// deleting one source of a multi-source event is too, because the row
/// survives on its next-best source.
///
/// A write that changes nothing publishes no event at all, so a full provider
/// snapshot re-observing thousands of unchanged events stays quiet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CalendarTopicEvent {
    /// The event row was inserted.
    #[serde(rename = "calendar_event.created")]
    Created(CalendarEventMetadata),
    /// The event row was rewritten in place.
    #[serde(rename = "calendar_event.updated")]
    Updated(CalendarEventMetadata),
    /// The event row is gone: its last remaining source was retired.
    /// Consumers cannot re-read it, so this is the only signal that the
    /// entity existed and no longer does.
    #[serde(rename = "calendar_event.deleted")]
    Deleted(CalendarEventMetadata),
}

impl CalendarTopicEvent {
    /// The event entity this change concerns.
    pub fn event_id(&self) -> Uuid {
        self.metadata().event_id
    }

    /// The metadata common to every variant.
    pub fn metadata(&self) -> &CalendarEventMetadata {
        match self {
            Self::Created(metadata) | Self::Updated(metadata) | Self::Deleted(metadata) => metadata,
        }
    }
}

impl TopicEvent for CalendarTopicEvent {
    type Topic = MacroCalendarTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable event for [`MacroCalendarTopic`], keyed by the event entity id.
///
/// Keying by entity id keeps every change to one event on one partition, so a
/// consumer sharding by key applies them in order.
pub struct CalendarMacroEvent {
    key: String,
    event: Event<CalendarTopicEvent>,
}

impl CalendarMacroEvent {
    /// Builds an event for one change, keyed by the event entity id.
    pub fn for_change(event: CalendarTopicEvent) -> Self {
        let key = event.event_id().to_string();
        Self::new(key, event)
    }

    /// Builds an event from a topic-specific calendar event.
    pub fn new(key: impl Into<String>, event: CalendarTopicEvent) -> Self {
        Self::with_event(key, Event::new(event))
    }

    /// Builds an event from a pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<CalendarTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }
}

impl MacroEvent for CalendarMacroEvent {
    type EventPayload = CalendarTopicEvent;

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
