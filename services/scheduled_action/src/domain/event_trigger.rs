//! Routine-owned event eligibility and exact selector matching.
//!
//! Adapters strip the broker envelope into [`IncomingEvent`]. Only explicitly
//! allowlisted, human-authored events can become compact [`EventReference`]s.

use activity::Actor;
use channels::domain::broker_events::ChannelTopicEvent;
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use documents::domain::events::DocumentTopicEvent;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::models::Schedule;

#[cfg(test)]
mod test;

/// Limits apply before deduplication, including repeated values.
pub const MAX_FILTERS: usize = 32;
pub const MAX_EVENTS_PER_FILTER: usize = 7;
pub const MAX_IDS_PER_FILTER: usize = 100;

/// Exactly one trigger per action. Existing cron validation is reused.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ActionTrigger {
    Cron {
        schedule: Schedule,
        #[schema(value_type = String)]
        timezone: Tz,
    },
    Events {
        filters: EventFilters,
    },
}

/// Closed allowlist: unknown names, deletions and ambiguous attribution are not
/// selectors. Adding a broker variant does not automatically enable routines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
pub enum EventName {
    #[serde(rename = "document.created")]
    DocumentCreated,
    #[serde(rename = "document.updated")]
    DocumentUpdated,
    #[serde(rename = "channel.created")]
    ChannelCreated,
    #[serde(rename = "channel.message_posted")]
    ChannelMessagePosted,
    #[serde(rename = "channel.mentioned")]
    ChannelMentioned,
    #[serde(rename = "channel.message_patched")]
    ChannelMessagePatched,
    #[serde(rename = "channel.message_attachment_created")]
    ChannelMessageAttachmentCreated,
}

impl EventName {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DocumentCreated => "document.created",
            Self::DocumentUpdated => "document.updated",
            Self::ChannelCreated => "channel.created",
            Self::ChannelMessagePosted => "channel.message_posted",
            Self::ChannelMentioned => "channel.mentioned",
            Self::ChannelMessagePatched => "channel.message_patched",
            Self::ChannelMessageAttachmentCreated => "channel.message_attachment_created",
        }
    }

    pub const fn entity_type(self) -> EventEntityType {
        match self {
            Self::DocumentCreated | Self::DocumentUpdated => EventEntityType::Document,
            _ => EventEntityType::Channel,
        }
    }

    const fn has_message(self) -> bool {
        !matches!(
            self,
            Self::DocumentCreated | Self::DocumentUpdated | Self::ChannelCreated
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EventEntityType {
    Document,
    Channel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum FilterValidationError {
    #[error("expected between 1 and 32 filters")]
    FilterCount,
    #[error("expected between 1 and 7 event names per filter")]
    EventCount,
    #[error("expected at most 100 entity IDs per filter")]
    IdCount,
}

/// An event name AND an entity ID must match within the same filter.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
#[serde(try_from = "FilterInput")]
pub struct EventFilter {
    events: Vec<EventName>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Vec<String>>)]
    ids: Option<Vec<Uuid>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FilterInput {
    events: Vec<EventName>,
    #[serde(default)]
    ids: Option<Vec<Uuid>>,
}

impl TryFrom<FilterInput> for EventFilter {
    type Error = FilterValidationError;

    fn try_from(input: FilterInput) -> Result<Self, Self::Error> {
        Self::new(input.events, input.ids)
    }
}

impl EventFilter {
    pub fn new(
        mut events: Vec<EventName>,
        mut ids: Option<Vec<Uuid>>,
    ) -> Result<Self, FilterValidationError> {
        if events.is_empty() || events.len() > MAX_EVENTS_PER_FILTER {
            return Err(FilterValidationError::EventCount);
        }
        if ids
            .as_ref()
            .is_some_and(|ids| ids.len() > MAX_IDS_PER_FILTER)
        {
            return Err(FilterValidationError::IdCount);
        }
        events.sort_unstable();
        events.dedup();
        if let Some(ids) = &mut ids {
            ids.sort_unstable();
            ids.dedup();
        }
        Ok(Self { events, ids })
    }

    pub fn events(&self) -> &[EventName] {
        &self.events
    }

    /// `None` matches every ID; `Some([])` matches nothing.
    pub fn ids(&self) -> Option<&[Uuid]> {
        self.ids.as_deref()
    }

    pub fn accepts(&self, name: EventName, entity_id: Uuid) -> bool {
        self.events.contains(&name) && self.ids.as_ref().is_none_or(|ids| ids.contains(&entity_id))
    }
}

/// Bounded nonempty OR of filters, canonicalized to remove duplicates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(try_from = "Vec<EventFilter>", into = "Vec<EventFilter>")]
pub struct EventFilters(Vec<EventFilter>);

impl TryFrom<Vec<EventFilter>> for EventFilters {
    type Error = FilterValidationError;

    fn try_from(mut filters: Vec<EventFilter>) -> Result<Self, Self::Error> {
        if filters.is_empty() || filters.len() > MAX_FILTERS {
            return Err(FilterValidationError::FilterCount);
        }
        filters.sort_unstable();
        filters.dedup();
        Ok(Self(filters))
    }
}

impl From<EventFilters> for Vec<EventFilter> {
    fn from(filters: EventFilters) -> Self {
        filters.0
    }
}

impl EventFilters {
    pub fn as_slice(&self) -> &[EventFilter] {
        &self.0
    }

    /// Publication time comes only from the UUIDv7, never ingestion or metadata
    /// timestamps. The activation boundary is inclusive.
    pub fn matches(&self, event: &EventReference, activated_at: DateTime<Utc>) -> bool {
        event.published_at() >= activated_at
            && self
                .0
                .iter()
                .any(|filter| filter.accepts(event.event_name, event.entity_id))
    }
}

/// A verified RFC UUIDv7 whose embedded publication timestamp is representable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "Uuid", into = "Uuid")]
pub struct EventId(Uuid);

impl TryFrom<Uuid> for EventId {
    type Error = EventRejection;

    fn try_from(id: Uuid) -> Result<Self, Self::Error> {
        // Check the RFC variant as well as the version nibble.
        if id.get_version_num() != 7 || id.as_bytes()[8] & 0xc0 != 0x80 {
            return Err(EventRejection::InvalidIdentity);
        }
        let timestamp = id.get_timestamp().ok_or(EventRejection::InvalidIdentity)?;
        let (seconds, nanos) = timestamp.to_unix();
        let seconds = i64::try_from(seconds).map_err(|_| EventRejection::InvalidIdentity)?;
        DateTime::<Utc>::from_timestamp(seconds, nanos).ok_or(EventRejection::InvalidIdentity)?;
        Ok(Self(id))
    }
}

impl From<EventId> for Uuid {
    fn from(id: EventId) -> Self {
        id.0
    }
}

impl EventId {
    pub fn as_uuid(self) -> Uuid {
        self.0
    }

    pub fn published_at(self) -> DateTime<Utc> {
        let (seconds, nanos) = self.0.get_timestamp().expect("validated UUIDv7").to_unix();
        DateTime::from_timestamp(seconds as i64, nanos).expect("validated publication timestamp")
    }
}

/// Minimal durable context. No content, actor, owner or full envelope is kept.
/// The entity kind and publication timestamp derive from the name and event ID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "EventReferenceInput")]
pub struct EventReference {
    event_id: EventId,
    event_name: EventName,
    entity_id: Uuid,
    message_id: Option<Uuid>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EventReferenceInput {
    event_id: EventId,
    event_name: EventName,
    entity_id: Uuid,
    message_id: Option<Uuid>,
}

impl TryFrom<EventReferenceInput> for EventReference {
    type Error = EventRejection;

    fn try_from(input: EventReferenceInput) -> Result<Self, Self::Error> {
        if input.event_name.has_message() != input.message_id.is_some() {
            return Err(EventRejection::InvalidContext);
        }
        Ok(Self {
            event_id: input.event_id,
            event_name: input.event_name,
            entity_id: input.entity_id,
            message_id: input.message_id,
        })
    }
}

impl EventReference {
    pub fn event_id(&self) -> EventId {
        self.event_id
    }
    pub fn event_name(&self) -> EventName {
        self.event_name
    }
    pub fn entity_type(&self) -> EventEntityType {
        self.event_name.entity_type()
    }
    pub fn entity_id(&self) -> Uuid {
        self.entity_id
    }
    pub fn message_id(&self) -> Option<Uuid> {
        self.message_id
    }
    pub fn published_at(&self) -> DateTime<Utc> {
        self.event_id.published_at()
    }
}

/// Domain event payloads only; no broker keys, offsets, messages or clients.
#[derive(Debug, Clone)]
pub enum EventPayload {
    Document(DocumentTopicEvent),
    Channel(ChannelTopicEvent),
}

#[derive(Debug, Clone)]
pub struct IncomingEvent {
    pub event_id: Uuid,
    pub schema_version: u8,
    pub payload: EventPayload,
}

/// Permanent rejection: consumers may advance after recording this disposition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum EventRejection {
    #[error("unsupported event schema")]
    UnsupportedSchema,
    #[error("unsupported event name")]
    UnsupportedEvent,
    #[error("event attribution is not unambiguously human")]
    UnsafeAttribution,
    #[error("event identity is not a verifiable UUIDv7")]
    InvalidIdentity,
    #[error("invalid entity UUID")]
    InvalidEntityId,
    #[error("event context does not match its event name")]
    InvalidContext,
}

fn require_human(actor: Option<&Actor<'static>>, delegated: bool) -> Result<(), EventRejection> {
    if !delegated && actor.is_some_and(|actor| actor.as_user().is_some()) {
        Ok(())
    } else {
        Err(EventRejection::UnsafeAttribution)
    }
}

fn document_actor(
    actor: Option<&Actor<'static>>,
    fallback: Option<&MacroUserIdStr<'static>>,
    delegated: bool,
) -> Result<(), EventRejection> {
    if actor.is_some() || delegated {
        require_human(actor, delegated)
    } else if fallback.is_some() {
        Ok(())
    } else {
        Err(EventRejection::UnsafeAttribution)
    }
}

impl IncomingEvent {
    /// Fail closed on attribution, identity and schema. Wildcard arms are
    /// deliberate: future source variants remain non-triggering by default.
    pub fn normalize(&self) -> Result<EventReference, EventRejection> {
        // Both currently supported source schemas are version 1. A producer
        // version change requires reviewing eligibility before accepting it.
        if self.schema_version != 1 {
            return Err(EventRejection::UnsupportedSchema);
        }
        let event_id = EventId::try_from(self.event_id)?;
        let (event_name, entity_id, message_id) = match &self.payload {
            EventPayload::Document(event) => {
                let (name, id) = match event {
                    DocumentTopicEvent::Created(data) => {
                        require_human(data.actor.as_ref(), data.on_behalf_of.is_some())?;
                        (EventName::DocumentCreated, &data.document_id)
                    }
                    DocumentTopicEvent::Updated(data) => {
                        document_actor(
                            data.actor.as_ref(),
                            data.actor_user_id.as_ref(),
                            data.on_behalf_of.is_some(),
                        )?;
                        (EventName::DocumentUpdated, &data.document_id)
                    }
                    _ => return Err(EventRejection::UnsupportedEvent),
                };
                let id = Uuid::parse_str(id).map_err(|_| EventRejection::InvalidEntityId)?;
                (name, id, None)
            }
            EventPayload::Channel(event) => match event {
                ChannelTopicEvent::Created(data) => {
                    require_human(Some(&data.actor), data.on_behalf_of.is_some())?;
                    (EventName::ChannelCreated, data.channel_id, None)
                }
                ChannelTopicEvent::MessagePosted(data) => {
                    require_human(Some(&data.sender), data.triggered_by.is_some())?;
                    (
                        EventName::ChannelMessagePosted,
                        data.channel_id,
                        Some(data.message_id),
                    )
                }
                ChannelTopicEvent::Mentioned(data) => {
                    require_human(Some(&data.sender), false)?;
                    (
                        EventName::ChannelMentioned,
                        data.channel_id,
                        Some(data.message_id),
                    )
                }
                ChannelTopicEvent::MessagePatched(data) => {
                    require_human(Some(&data.actor), false)?;
                    (
                        EventName::ChannelMessagePatched,
                        data.channel_id,
                        Some(data.message_id),
                    )
                }
                ChannelTopicEvent::MessageAttachmentCreated(data) => {
                    require_human(Some(&data.actor), false)?;
                    (
                        EventName::ChannelMessageAttachmentCreated,
                        data.channel_id,
                        Some(data.message_id),
                    )
                }
                _ => return Err(EventRejection::UnsupportedEvent),
            },
        };
        Ok(EventReference {
            event_id,
            event_name,
            entity_id,
            message_id,
        })
    }
}
