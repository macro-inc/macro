//! Kafka event models for the `macro.calendar` topic.

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroCalendarTopic;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Metadata for [`CalendarTopicEvent::Changed`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CalendarEventChangedMetadata {
    /// The event entity whose canonical state changed.
    pub event_id: Uuid,
    /// Owner of this per-user event projection. Carried so a consumer can
    /// route or filter without a database read; everything else about the
    /// event is re-read from the row.
    pub owner_id: String,
}

/// Calendar events published to [`MacroCalendarTopic`].
///
/// One variant, deliberately. Every calendar write funnels through
/// `CalendarRepository::upsert_event` or a source retirement, and neither
/// tells the caller whether the row was created, updated, or removed —
/// retiring one source leaves the event alive when another still backs it.
/// So the topic reports that an event's canonical state moved and leaves
/// consumers to re-read it, which is what they would have to do anyway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CalendarTopicEvent {
    /// An event's canonical state changed: created, updated, or removed.
    /// Consumers re-read the row; its absence means it is gone.
    #[serde(rename = "calendar_event.changed")]
    Changed(CalendarEventChangedMetadata),
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
    /// Builds a changed event keyed by the event entity id.
    pub fn changed(metadata: CalendarEventChangedMetadata) -> Self {
        let key = metadata.event_id.to_string();
        Self::new(key, CalendarTopicEvent::Changed(metadata))
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
