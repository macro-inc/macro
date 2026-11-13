//! Kafka event models for the `macro.calendar` topic.

#[cfg(test)]
mod test;

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

    type PublicPayload = CalendarPublicEvent;

    fn exposure(
        &self,
    ) -> Result<
        macro_event_broker::exposure::Exposure<'_, Self::PublicPayload>,
        macro_event_broker::exposure::ExposureError,
    > {
        use macro_event_broker::exposure::{
            Audience, EntityRef, EntityType, Exposure, PublicEvent, Stage, parse_user_id,
        };
        use std::borrow::Cow;

        let metadata = self.metadata();
        let change = CalendarEventChange {
            event_id: metadata.event_id,
        };
        let (name, payload) = match self {
            Self::Created(_) => (
                "calendar_event.created",
                CalendarPublicEvent::Created(change),
            ),
            Self::Updated(_) => (
                "calendar_event.updated",
                CalendarPublicEvent::Updated(change),
            ),
            Self::Deleted(_) => (
                "calendar_event.deleted",
                CalendarPublicEvent::Deleted(change),
            ),
        };
        // A calendar is personal data: only its owner, never their teams.
        Ok(Exposure::Public(PublicEvent {
            name,
            entity: EntityRef::new(EntityType::CalendarEvent, metadata.event_id.to_string()),
            audience: Audience::Recipient {
                user_id: parse_user_id(&metadata.owner_id)?,
            },
            stage: Stage::Preview,
            payload: Cow::Owned(payload),
        }))
    }
}

/// The public projection of a [`CalendarTopicEvent`], delivered only to the
/// calendar's owner. Clients read the event back through the API.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum CalendarPublicEvent {
    /// A calendar event was created.
    #[serde(rename = "calendar_event.created")]
    Created(CalendarEventChange),
    /// A calendar event was updated.
    #[serde(rename = "calendar_event.updated")]
    Updated(CalendarEventChange),
    /// A calendar event was deleted.
    #[serde(rename = "calendar_event.deleted")]
    Deleted(CalendarEventChange),
}

/// Public body of every calendar event: which event changed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct CalendarEventChange {
    /// The calendar event.
    pub event_id: Uuid,
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
