//! Routine-owned event eligibility and exact selector matching.
//!
//! Adapters strip the broker envelope into [`IncomingEvent`]. Only explicitly
//! allowlisted human actions, inbound emails, call lifecycle events and GitHub
//! App deliveries become [`EventReference`]s. GitHub deliveries can also be
//! filtered on exact payload values.

use activity::Actor;
use call::domain::events::CallTopicEvent;
use channels::domain::broker_events::ChannelTopicEvent;
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use document_sub_type::DocumentSubType;
use documents::domain::events::DocumentTopicEvent;
use email::domain::events::EmailTopicEvent;
use github::broker::GithubWebhookTopicEvent;
use github::domain::models::GithubWebhookReceived;
use jev::domain::YesNoQuestion;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use messages::domain::{
    events::{
        MessageAttachmentCreatedMetadata, MessageMentionedMetadata, MessagePatchedMetadata,
        MessagePostedMetadata,
    },
    models::MessageParent,
};
use models_properties::EntityType as PropertyEntityType;
use properties::domain::events::PropertyTopicEvent;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use system_properties::SystemPropertyKey;
use utoipa::ToSchema;

use super::models::Schedule;

mod github_selector;
mod payload_match;

pub use github_selector::{GithubSelector, GithubSelectorError, GithubSelectorInput};
pub use payload_match::{
    PayloadConditionInput, PayloadConditions, PayloadMatchError, PayloadScalar,
};

#[cfg(test)]
mod test;

/// Limits apply before deduplication, including repeated values.
pub const MAX_FILTERS: usize = 32;
pub const MAX_EVENTS_PER_FILTER: usize = 15;
pub const MAX_IDS_PER_FILTER: usize = 100;

/// A routine may run on one trigger or any of several schedules and Macro events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
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
    Multiple {
        triggers: RoutineTriggers,
    },
}

/// An individual trigger in a routine's trigger list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum RoutineTrigger {
    Cron {
        schedule: Schedule,
        #[schema(value_type = String)]
        timezone: Tz,
    },
    Events {
        filters: EventFilters,
    },
}

/// Bounded schedules and one combined set of event filters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(try_from = "Vec<RoutineTrigger>", into = "Vec<RoutineTrigger>")]
pub struct RoutineTriggers(Vec<RoutineTrigger>);

impl TryFrom<Vec<RoutineTrigger>> for RoutineTriggers {
    type Error = &'static str;

    fn try_from(triggers: Vec<RoutineTrigger>) -> Result<Self, Self::Error> {
        if triggers.is_empty() || triggers.len() > 16 {
            return Err("a routine needs between 1 and 16 triggers");
        }
        if triggers
            .iter()
            .filter(|t| matches!(t, RoutineTrigger::Events { .. }))
            .count()
            > 1
        {
            return Err("combine event selectors in one event trigger");
        }
        Ok(Self(triggers))
    }
}

impl RoutineTriggers {
    pub fn as_slice(&self) -> &[RoutineTrigger] {
        &self.0
    }
}

impl From<RoutineTriggers> for Vec<RoutineTrigger> {
    fn from(triggers: RoutineTriggers) -> Self {
        triggers.0
    }
}

impl ActionTrigger {
    pub fn event_filters(&self) -> Option<&EventFilters> {
        match self {
            Self::Events { filters } => Some(filters),
            Self::Multiple { triggers } => triggers.0.iter().find_map(|trigger| match trigger {
                RoutineTrigger::Events { filters } => Some(filters),
                _ => None,
            }),
            _ => None,
        }
    }

    pub fn has_schedule(&self) -> bool {
        match self {
            Self::Cron { .. } => true,
            Self::Multiple { triggers } => triggers
                .0
                .iter()
                .any(|t| matches!(t, RoutineTrigger::Cron { .. })),
            _ => false,
        }
    }

    /// The first upcoming firing across all schedules. Simultaneous firings run once.
    pub fn next_run_after(&self, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
        let next = |schedule: &Schedule, timezone: Tz| {
            schedule
                .as_cron()
                .after(&after.with_timezone(&timezone))
                .next()
                .map(|time| time.with_timezone(&Utc))
        };
        match self {
            Self::Cron { schedule, timezone } => next(schedule, *timezone),
            Self::Multiple { triggers } => triggers
                .0
                .iter()
                .filter_map(|trigger| match trigger {
                    RoutineTrigger::Cron { schedule, timezone } => next(schedule, *timezone),
                    RoutineTrigger::Events { .. } => None,
                })
                .min(),
            _ => None,
        }
    }
}

/// Closed allowlist: unknown names, deletions and ambiguous attribution are not
/// selectors. Adding a broker variant does not automatically enable routines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
pub enum EventName {
    #[serde(rename = "document.created")]
    DocumentCreated,
    #[serde(rename = "document.updated")]
    DocumentUpdated,
    #[serde(rename = "document.deleted")]
    DocumentDeleted,
    #[serde(rename = "task.created")]
    TaskCreated,
    #[serde(rename = "task.status_changed")]
    TaskStatusChanged,
    #[serde(rename = "task.priority_changed")]
    TaskPriorityChanged,
    #[serde(rename = "task.property_changed")]
    TaskPropertyChanged,
    #[serde(rename = "email.message_received")]
    EmailMessageReceived,
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
    #[serde(rename = "call.started")]
    CallStarted,
    #[serde(rename = "call.ended")]
    CallEnded,
    /// A delivery from Macro's GitHub App; the filter's `github` selector narrows it.
    #[serde(rename = "github")]
    Github,
}

impl EventName {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DocumentCreated => "document.created",
            Self::DocumentUpdated => "document.updated",
            Self::DocumentDeleted => "document.deleted",
            Self::TaskCreated => "task.created",
            Self::TaskStatusChanged => "task.status_changed",
            Self::TaskPriorityChanged => "task.priority_changed",
            Self::TaskPropertyChanged => "task.property_changed",
            Self::EmailMessageReceived => "email.message_received",
            Self::ChannelCreated => "channel.created",
            Self::ChannelMessagePosted => "channel.message_posted",
            Self::ChannelMentioned => "channel.mentioned",
            Self::ChannelMessagePatched => "channel.message_patched",
            Self::ChannelMessageAttachmentCreated => "channel.message_attachment_created",
            Self::CallStarted => "call.started",
            Self::CallEnded => "call.ended",
            Self::Github => "github",
        }
    }

    pub const fn entity_type(self) -> EventEntityType {
        match self {
            Self::DocumentCreated
            | Self::DocumentUpdated
            | Self::DocumentDeleted
            | Self::TaskCreated
            | Self::TaskStatusChanged
            | Self::TaskPriorityChanged
            | Self::TaskPropertyChanged => EventEntityType::Document,
            Self::EmailMessageReceived => EventEntityType::EmailThread,
            Self::CallStarted | Self::CallEnded => EventEntityType::Call,
            Self::ChannelCreated
            | Self::ChannelMessagePosted
            | Self::ChannelMentioned
            | Self::ChannelMessagePatched
            | Self::ChannelMessageAttachmentCreated => EventEntityType::Channel,
            Self::Github => EventEntityType::GithubInstallation,
        }
    }

    /// Events from outside Macro: they carry their payload, take a payload
    /// match, and stand alone in their filter.
    const fn is_external(self) -> bool {
        matches!(self, Self::Github)
    }

    const fn has_message(self) -> bool {
        matches!(
            self,
            Self::ChannelMessagePosted
                | Self::ChannelMentioned
                | Self::ChannelMessagePatched
                | Self::ChannelMessageAttachmentCreated
                | Self::EmailMessageReceived
        )
    }

    /// Status and priority also match any-property selectors. The original
    /// event ID still deduplicates routines that subscribe to both names.
    pub const fn general_event(self) -> Option<Self> {
        match self {
            Self::TaskStatusChanged | Self::TaskPriorityChanged => Some(Self::TaskPropertyChanged),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EventEntityType {
    Document,
    Channel,
    EmailThread,
    Call,
    /// The GitHub App installation a delivery came through.
    GithubInstallation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum FilterValidationError {
    #[error("expected between 1 and 32 filters")]
    FilterCount,
    #[error("expected between 1 and 15 event names per filter")]
    EventCount,
    #[error("expected at most 100 entity IDs per filter")]
    IdCount,
    #[error("github needs a filter of its own, without ids")]
    ExternalEventMix,
    #[error("a github filter needs a github selector, and only it takes one")]
    GithubSelector,
    #[error("only github filters take a payload match")]
    PayloadMatch,
    #[error(transparent)]
    Github(#[from] GithubSelectorError),
    #[error(transparent)]
    Payload(#[from] PayloadMatchError),
}

/// An event name AND an entity ID must match within the same filter. A
/// condition further requires the event's content to answer it with yes.
///
/// `github` comes from outside Macro and carries its payload: it stands
/// alone in its filter, takes no ids, and may require
/// exact payload values with `match`. A `github` filter narrows deliveries
/// with its `github` selector.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
#[serde(try_from = "FilterInput")]
pub struct EventFilter {
    events: Vec<EventName>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Vec<String>>)]
    ids: Option<Vec<Uuid>>,
    /// Which GitHub deliveries match; required for, and only for, `github`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<GithubSelectorInput>)]
    github: Option<GithubSelector>,
    /// Exact tests on the payload, all of which must pass.
    #[serde(rename = "match", skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Vec<PayloadConditionInput>>)]
    payload: Option<PayloadConditions>,
    /// Yes/no question about the triggering content, e.g. "Is this email an
    /// invoice?". The routine runs only when the answer is yes.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<String>, max_length = 500)]
    condition: Option<YesNoQuestion>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FilterInput {
    events: Vec<EventName>,
    #[serde(default)]
    ids: Option<Vec<Uuid>>,
    #[serde(default)]
    github: Option<GithubSelector>,
    #[serde(default, rename = "match")]
    payload: Option<PayloadConditions>,
    #[serde(default)]
    condition: Option<YesNoQuestion>,
}

impl TryFrom<FilterInput> for EventFilter {
    type Error = FilterValidationError;

    fn try_from(input: FilterInput) -> Result<Self, Self::Error> {
        Self::new(input.events, input.ids)?
            .with_condition(input.condition)
            .with_external(input.github, input.payload)
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
        if events.iter().any(|name| name.is_external()) && (events.len() > 1 || ids.is_some()) {
            return Err(FilterValidationError::ExternalEventMix);
        }
        events.sort_unstable();
        events.dedup();
        if let Some(ids) = &mut ids {
            ids.sort_unstable();
            ids.dedup();
        }
        Ok(Self {
            events,
            ids,
            github: None,
            payload: None,
            condition: None,
        })
    }

    pub fn with_condition(mut self, condition: Option<YesNoQuestion>) -> Self {
        self.condition = condition;
        self
    }

    /// Attach the GitHub selector and payload match an external filter takes.
    pub fn with_external(
        mut self,
        github: Option<GithubSelector>,
        payload: Option<PayloadConditions>,
    ) -> Result<Self, FilterValidationError> {
        let is_github = self.events == [EventName::Github];
        if is_github != github.is_some() {
            return Err(FilterValidationError::GithubSelector);
        }
        if payload.is_some() && !self.events.iter().any(|name| name.is_external()) {
            return Err(FilterValidationError::PayloadMatch);
        }
        self.github = github;
        self.payload = payload;
        Ok(self)
    }

    pub fn events(&self) -> &[EventName] {
        &self.events
    }

    /// `None` matches every ID; `Some([])` matches nothing.
    pub fn ids(&self) -> Option<&[Uuid]> {
        self.ids.as_deref()
    }

    pub fn github(&self) -> Option<&GithubSelector> {
        self.github.as_ref()
    }

    pub fn payload(&self) -> Option<&PayloadConditions> {
        self.payload.as_ref()
    }

    pub fn condition(&self) -> Option<&YesNoQuestion> {
        self.condition.as_ref()
    }

    pub fn accepts(&self, event: &EventReference) -> bool {
        let name = event.event_name;
        let named = self.events.contains(&name)
            || name
                .general_event()
                .is_some_and(|general| self.events.contains(&general));
        named
            && match &event.source {
                EventSource::Entity { entity_id, .. } => {
                    self.ids.as_ref().is_none_or(|ids| ids.contains(entity_id))
                }
                EventSource::Github(delivery) => {
                    self.github
                        .as_ref()
                        .is_some_and(|selector| selector.accepts(delivery))
                        && self.payload_accepts(delivery.payload.as_ref())
                }
            }
    }

    fn payload_accepts(&self, payload: Option<&Value>) -> bool {
        self.payload
            .as_ref()
            .is_none_or(|conditions| conditions.matches(payload))
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
        event.published_at() >= activated_at && self.0.iter().any(|filter| filter.accepts(event))
    }

    pub fn has_conditions(&self) -> bool {
        self.0.iter().any(|filter| filter.condition.is_some())
    }

    pub fn watches_github(&self) -> bool {
        self.0
            .iter()
            .any(|filter| filter.events.contains(&EventName::Github))
    }

    /// What a matching event must satisfy before its run starts. A matching
    /// filter without a condition runs unconditionally; otherwise any one of
    /// the matching filters' conditions is enough.
    pub fn condition_requirement(&self, event: &EventReference) -> ConditionRequirement {
        let mut conditions = Vec::new();
        for filter in self.0.iter().filter(|filter| filter.accepts(event)) {
            match &filter.condition {
                None => return ConditionRequirement::Unconditional,
                Some(condition) => conditions.push(condition.clone()),
            }
        }
        conditions.sort_unstable();
        conditions.dedup();
        if conditions.is_empty() {
            ConditionRequirement::Unconditional
        } else {
            ConditionRequirement::AnyOf(conditions)
        }
    }
}

/// Conditions an event must meet before a matching routine runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConditionRequirement {
    Unconditional,
    /// Distinct, nonempty; one yes is enough.
    AnyOf(Vec<YesNoQuestion>),
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

/// Durable context. A Macro event keeps no content, actor, owner or full
/// envelope: dispatch reads its content again, as the routine's owner. An
/// external delivery has nothing to read again, so it keeps its payload.
/// The entity kind and publication timestamp derive from the name and event ID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "EventReferenceInput", into = "EventReferenceInput")]
pub struct EventReference {
    event_id: EventId,
    event_name: EventName,
    source: EventSource,
}

/// What an event is about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventSource {
    /// A Macro entity, and the message the event concerns.
    Entity {
        entity_id: Uuid,
        message_id: Option<Uuid>,
    },
    /// A delivery from Macro's GitHub App. Boxed: it carries its payload.
    Github(Box<GithubWebhookReceived>),
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct EventReferenceInput {
    event_id: EventId,
    event_name: EventName,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    entity_id: Option<Uuid>,
    /// Always written for Macro events, which predate external ones.
    #[serde(default, skip_serializing_if = "skip_message_id")]
    message_id: Option<Option<Uuid>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    github: Option<Box<GithubWebhookReceived>>,
}

fn skip_message_id(message_id: &Option<Option<Uuid>>) -> bool {
    message_id.is_none()
}

impl TryFrom<EventReferenceInput> for EventReference {
    type Error = EventRejection;

    fn try_from(input: EventReferenceInput) -> Result<Self, Self::Error> {
        let name = input.event_name;
        let source = match (input.entity_id, input.github) {
            (Some(entity_id), None) if !name.is_external() => {
                let message_id = input.message_id.flatten();
                if name.has_message() != message_id.is_some() {
                    return Err(EventRejection::InvalidContext);
                }
                EventSource::Entity {
                    entity_id,
                    message_id,
                }
            }
            (None, Some(delivery)) if name == EventName::Github => EventSource::Github(delivery),
            _ => return Err(EventRejection::InvalidContext),
        };
        Ok(Self {
            event_id: input.event_id,
            event_name: name,
            source,
        })
    }
}

impl From<EventReference> for EventReferenceInput {
    fn from(event: EventReference) -> Self {
        let mut input = Self {
            event_id: event.event_id,
            event_name: event.event_name,
            entity_id: None,
            message_id: None,
            github: None,
        };
        match event.source {
            EventSource::Entity {
                entity_id,
                message_id,
            } => {
                input.entity_id = Some(entity_id);
                input.message_id = Some(message_id);
            }
            EventSource::Github(delivery) => input.github = Some(delivery),
        }
        input
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
    pub fn source(&self) -> &EventSource {
        &self.source
    }
    /// The Macro entity the event is about; None for external deliveries.
    pub fn entity_id(&self) -> Option<Uuid> {
        match self.source {
            EventSource::Entity { entity_id, .. } => Some(entity_id),
            EventSource::Github(_) => None,
        }
    }
    pub fn message_id(&self) -> Option<Uuid> {
        match self.source {
            EventSource::Entity { message_id, .. } => message_id,
            EventSource::Github(_) => None,
        }
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
    Message(MessageFact),
    Property(PropertyTopicEvent),
    Email(EmailTopicEvent),
    Call(CallTopicEvent),
    Github(GithubWebhookTopicEvent),
}

/// The message facts routines can trigger on, from `macro.messages`. Anything
/// else on that topic arrives as [`MessageFact::Other`] and never triggers.
#[derive(Debug, Clone)]
pub enum MessageFact {
    Posted(MessagePostedMetadata),
    Mentioned(MessageMentionedMetadata),
    Patched(MessagePatchedMetadata),
    AttachmentCreated(MessageAttachmentCreatedMetadata),
    Other,
}

/// Routines trigger on channel conversations only; other parents never match.
fn channel_parent(parent: &MessageParent) -> Result<Uuid, EventRejection> {
    match parent {
        MessageParent::Channel(id) => Ok(*id),
        _ => Err(EventRejection::UnsupportedEvent),
    }
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
    /// Mentions belong to the mentioned user, inbound mail to its inbox owner,
    /// a started call to who created it, and an ended call to who joined it.
    /// Entity access is checked separately at admission and dispatch. These
    /// audience restrictions never turn an event into an access grant.
    pub fn is_for_owner(&self, owner: &MacroUserIdStr<'static>) -> bool {
        match &self.payload {
            EventPayload::Message(MessageFact::Mentioned(data)) => {
                data.mentioned.entity_type == "user" && data.mentioned.entity_id == owner.as_ref()
            }
            EventPayload::Email(EmailTopicEvent::MessageReceived(data)) => &data.owner == owner,
            EventPayload::Call(CallTopicEvent::Started(data)) => &data.created_by == owner,
            EventPayload::Call(CallTopicEvent::RecordArchived(data)) => {
                data.participants.contains(owner)
            }
            _ => true,
        }
    }

    /// Fail closed on attribution, identity and schema. Wildcard arms are
    /// deliberate: future source variants remain non-triggering by default.
    pub fn normalize(&self) -> Result<EventReference, EventRejection> {
        // All currently supported source schemas are version 1. A producer
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
                        let name = if data.sub_type == Some(DocumentSubType::Task) {
                            EventName::TaskCreated
                        } else {
                            EventName::DocumentCreated
                        };
                        (name, &data.document_id)
                    }
                    DocumentTopicEvent::Deleted(data) => {
                        document_actor(
                            data.actor.as_ref(),
                            data.actor_user_id.as_ref(),
                            data.on_behalf_of.is_some(),
                        )?;
                        if data.sub_type == Some(DocumentSubType::Task) {
                            return Err(EventRejection::UnsupportedEvent);
                        }
                        (EventName::DocumentDeleted, &data.document_id)
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
                _ => return Err(EventRejection::UnsupportedEvent),
            },
            EventPayload::Message(fact) => match fact {
                MessageFact::Posted(data) => {
                    let channel_id = channel_parent(&data.parent)?;
                    require_human(Some(&data.sender), data.triggered_by.is_some())?;
                    (
                        EventName::ChannelMessagePosted,
                        channel_id,
                        Some(data.message_id),
                    )
                }
                MessageFact::Mentioned(data) => {
                    let channel_id = channel_parent(&data.parent)?;
                    require_human(Some(&data.sender), false)?;
                    if data.mentioned.entity_type != "user" {
                        return Err(EventRejection::UnsupportedEvent);
                    }
                    (
                        EventName::ChannelMentioned,
                        channel_id,
                        Some(data.message_id),
                    )
                }
                MessageFact::Patched(data) => {
                    let channel_id = channel_parent(&data.parent)?;
                    require_human(Some(&data.actor), false)?;
                    (
                        EventName::ChannelMessagePatched,
                        channel_id,
                        Some(data.message_id),
                    )
                }
                MessageFact::AttachmentCreated(data) => {
                    let channel_id = channel_parent(&data.parent)?;
                    require_human(Some(&data.actor), false)?;
                    (
                        EventName::ChannelMessageAttachmentCreated,
                        channel_id,
                        Some(data.message_id),
                    )
                }
                MessageFact::Other => return Err(EventRejection::UnsupportedEvent),
            },
            EventPayload::Property(event) => {
                let (name, id) = task_property_event(event)?;
                let id = Uuid::parse_str(id).map_err(|_| EventRejection::InvalidEntityId)?;
                (name, id, None)
            }
            EventPayload::Email(EmailTopicEvent::MessageReceived(data)) => {
                // The email domain emits this only for newly received mail,
                // never sent messages, drafts or historical backfills.
                if data.is_spam_or_trash {
                    return Err(EventRejection::UnsupportedEvent);
                }
                (
                    EventName::EmailMessageReceived,
                    data.thread_id,
                    Some(data.message_id),
                )
            }
            EventPayload::Email(_) => return Err(EventRejection::UnsupportedEvent),
            EventPayload::Call(CallTopicEvent::Started(data)) => {
                // The creator is always a Macro account; the call is theirs.
                (EventName::CallStarted, data.call_id, None)
            }
            EventPayload::Call(CallTopicEvent::RecordArchived(data)) => {
                // A call ends when its people leave, not by anyone's action;
                // it is theirs only if a Macro account joined it.
                if data.participants.is_empty() {
                    return Err(EventRejection::UnsafeAttribution);
                }
                (EventName::CallEnded, data.call_id, None)
            }
            EventPayload::Call(_) => return Err(EventRejection::UnsupportedEvent),
            EventPayload::Github(GithubWebhookTopicEvent::Received(delivery)) => {
                // Every event GitHub sends may trigger; its name only has to be one
                // a selector could name. Bots are left to each filter.
                if !github_selector::valid_event_name(&delivery.event) {
                    return Err(EventRejection::UnsupportedEvent);
                }
                return Ok(EventReference {
                    event_id,
                    event_name: EventName::Github,
                    source: EventSource::Github(Box::new(delivery.clone())),
                });
            }
        };
        Ok(EventReference {
            event_id,
            event_name,
            source: EventSource::Entity {
                entity_id,
                message_id,
            },
        })
    }
}

fn task_property_event(event: &PropertyTopicEvent) -> Result<(EventName, &str), EventRejection> {
    let (entity_type, entity_id, property_id, actor, fallback, delegated) = match event {
        PropertyTopicEvent::EntityPropertyUpdated(data) => {
            if data.value == data.previous_value {
                return Err(EventRejection::UnsupportedEvent);
            }
            (
                &data.entity_type,
                data.entity_id.as_str(),
                Some(data.property_definition_id),
                data.actor.as_ref(),
                data.actor_user_id.as_ref(),
                data.on_behalf_of.is_some(),
            )
        }
        PropertyTopicEvent::EntityPropertyDeleted(data) => (
            &data.entity_type,
            data.entity_id.as_str(),
            Some(data.property_definition_id),
            data.actor.as_ref(),
            data.actor_user_id.as_ref(),
            data.on_behalf_of.is_some(),
        ),
        PropertyTopicEvent::EntityPropertiesCleared(data) => (
            &data.entity_type,
            data.entity_id.as_str(),
            None,
            data.actor.as_ref(),
            data.actor_user_id.as_ref(),
            data.on_behalf_of.is_some(),
        ),
        _ => return Err(EventRejection::UnsupportedEvent),
    };
    // The properties domain resolves document subtypes before publishing.
    if *entity_type != PropertyEntityType::Task {
        return Err(EventRejection::UnsupportedEvent);
    }
    document_actor(actor, fallback, delegated)?;
    let name = match property_id {
        Some(SystemPropertyKey::STATUS_UUID) => EventName::TaskStatusChanged,
        Some(SystemPropertyKey::PRIORITY_UUID) => EventName::TaskPriorityChanged,
        _ => EventName::TaskPropertyChanged,
    };
    Ok((name, entity_id))
}
