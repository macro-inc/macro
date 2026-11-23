//! Realtime Soup patch and broker event models.

use std::collections::HashSet;

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroSoupRealtimeTopic;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use serde::{Deserialize, Serialize};

/// A change to one value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum Patch<T> {
    /// The value was created or updated.
    #[serde(rename = "soup.updated")]
    Updated(T),
    /// The value was deleted.
    #[serde(rename = "soup.deleted")]
    Deleted(T),
}

impl<T> Patch<T> {
    /// Maps the value carried by this patch while preserving its operation.
    pub fn map<U>(self, map: impl FnOnce(T) -> U) -> Patch<U> {
        match self {
            Self::Updated(value) => Patch::Updated(map(value)),
            Self::Deleted(value) => Patch::Deleted(map(value)),
        }
    }

    /// Returns the value carried by this patch.
    pub fn value(&self) -> &T {
        match self {
            Self::Updated(value) | Self::Deleted(value) => value,
        }
    }
}

/// A patch paired with the entity used to resolve its recipients.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoupRealtimePatch {
    /// Patch delivered to each recipient.
    pub patch: Patch<Entity<'static>>,
    /// Entity whose current accessors should receive the patch; `None` when
    /// only `named_recipients` should.
    pub access_source: Option<Entity<'static>>,
    /// Users who also receive the patch: those the source event names because
    /// their access ended with the change, as when an entity is hard-deleted
    /// before its event is consumed.
    pub named_recipients: Vec<MacroUserIdStr<'static>>,
    /// Channel whose active members are left out of `named_recipients`: the
    /// event named them for a membership it ended, and they are members again
    /// by the time it is consumed. Its roster is read when the patch is
    /// delivered, past the audience cache, and also answers for the patches
    /// whose access source is this channel.
    pub named_unless_member_of: Option<Entity<'static>>,
}

impl SoupRealtimePatch {
    /// Creates a patch with an explicit recipient access source.
    pub fn new(patch: Patch<Entity<'static>>, access_source: Entity<'static>) -> Self {
        Self {
            patch,
            access_source: Some(access_source),
            named_recipients: Vec::new(),
            named_unless_member_of: None,
        }
    }

    /// Creates a patch whose entity also determines its recipients.
    pub fn for_entity(patch: Patch<Entity<'static>>) -> Self {
        let access_source = patch.value().clone();
        Self::new(patch, access_source)
    }

    /// Creates a patch for `users` alone, whatever anyone's current access:
    /// for people the source event names because the change ended theirs,
    /// while everyone else who can see the entity hears something else.
    pub fn only_for(patch: Patch<Entity<'static>>, users: Vec<MacroUserIdStr<'static>>) -> Self {
        Self {
            patch,
            access_source: None,
            named_recipients: users,
            named_unless_member_of: None,
        }
    }

    /// Creates a patch of a channel for `users` whose membership of it the
    /// source event ended, leaving out those who are members again when the
    /// patch is delivered: they were added back before the event was consumed,
    /// so the patches for its members reach them instead.
    pub fn only_for_former_members(
        patch: Patch<Entity<'static>>,
        users: Vec<MacroUserIdStr<'static>>,
    ) -> Self {
        let channel = patch.value().clone();
        Self {
            patch,
            access_source: None,
            named_recipients: users,
            named_unless_member_of: Some(channel),
        }
    }

    /// Also delivers the patch to `users`, whatever their current access.
    #[must_use]
    pub fn with_named_recipients(mut self, users: Vec<MacroUserIdStr<'static>>) -> Self {
        self.named_recipients = users;
        self
    }
}

/// Entities whose current accessors are the same users.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharedAccess {
    /// Entities each of these users can currently access.
    pub entities: Vec<Entity<'static>>,
    /// Current accessors of every one of the entities.
    pub users: Vec<MacroUserIdStr<'static>>,
}

/// What publishing one batch of patches reached.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Delivery {
    /// Each distinct, non-empty set of recipients among the batch's patches,
    /// with its users sorted.
    pub recipient_sets: HashSet<Vec<MacroUserIdStr<'static>>>,
    /// Number of recipient-targeted patches published.
    pub publish_count: usize,
}

/// One recipient-targeted patch after decoding the Soup topic event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoupRealtimeMessage {
    /// User to whom the patch is addressed.
    pub user_id: MacroUserIdStr<'static>,
    /// Entity patch addressed to the user.
    pub patch: Patch<Entity<'static>>,
}

impl SoupRealtimeMessage {
    /// Creates a patch addressed to a recipient.
    pub fn new(user_id: MacroUserIdStr<'static>, patch: Patch<Entity<'static>>) -> Self {
        Self { user_id, patch }
    }
}

/// Wire payload for [`MacroSoupRealtimeTopic`].
///
/// The recipient is included in the patch payload and repeated as the Kafka
/// key so consumers can route without hydrating a Soup item.
pub type SoupTopicEvent = Patch<(MacroUserIdStr<'static>, Entity<'static>)>;

impl TopicEvent for SoupTopicEvent {
    type Topic = MacroSoupRealtimeTopic;

    const SCHEMA_VERSION: u8 = 2;
}

/// Publishable realtime Soup event keyed by recipient user ID.
pub struct SoupMacroEvent {
    key: String,
    event: Event<SoupTopicEvent>,
}

impl SoupMacroEvent {
    /// Creates a recipient-keyed patch event.
    pub fn from_message(message: SoupRealtimeMessage) -> Self {
        let SoupRealtimeMessage { user_id, patch } = message;
        let key = user_id.as_ref().to_string();
        let event = patch.map(|entity| (user_id, entity));
        Self::with_event(key, Event::new(event))
    }

    /// Builds an event from its Kafka key and pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<SoupTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }

    /// Returns the recipient and entity patch carried by this event.
    pub fn into_message(self) -> SoupRealtimeMessage {
        match self.event.event {
            Patch::Updated((user_id, entity)) => {
                SoupRealtimeMessage::new(user_id, Patch::Updated(entity))
            }
            Patch::Deleted((user_id, entity)) => {
                SoupRealtimeMessage::new(user_id, Patch::Deleted(entity))
            }
        }
    }
}

impl MacroEvent for SoupMacroEvent {
    type EventPayload = SoupTopicEvent;

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
