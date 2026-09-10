//! The activity model — the protocol domains implement and the storage
//! shape the consumer persists.
//!
//! Ownership boundary: **this crate owns what an activity is; domains own
//! what counts as activity in their domain.** Domains construct activities
//! through two doors:
//!
//! - [`Activity::common`] for [`CommonAction`]s, which are valid on every
//!   entity kind by definition — no pairing proof needed.
//! - [`Activity::from_domain`] for entity-exclusive actions, reachable only
//!   through a domain-owned type implementing [`DomainActivity`]. The domain
//!   crate is the authority on its own action vocabulary and its projection
//!   into the durable [`Action`].
//!
//! [`Activity`] itself cannot be literal-constructed (private field), so an
//! invalid pairing like a document with a `Messaged` action has no
//! expressible path into storage.

#[cfg(test)]
mod test;

use std::sync::LazyLock;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// A principal that can act on entities: a user or a bot, as one
/// prefix-parseable string. An agent is a bot acting with `on_behalf_of`
/// set — agent-ness is relational, not an identity kind.
pub use channel_sender::ChannelSender as Actor;

/// Who performed an action, and whose feed it belongs on.
///
/// Stored as `actor_id` plus `subject_id` (`on_behalf_of ?? actor`).
#[derive(Debug, Clone, PartialEq)]
pub enum Attribution {
    /// The principal acted for themselves. Subject equals actor.
    Direct {
        /// Who mechanically acted.
        actor: Actor<'static>,
    },
    /// A bot or the platform acted for a user. Subject is that user.
    Delegated {
        /// Who mechanically acted.
        actor: Actor<'static>,
        /// Whose activity feed this belongs on.
        subject: MacroUserIdStr<'static>,
    },
}

impl Attribution {
    /// The principal acted for themselves.
    pub fn direct(actor: Actor<'static>) -> Self {
        Self::Direct { actor }
    }

    /// A bot or the platform acted for `subject`.
    pub fn delegated(actor: Actor<'static>, subject: MacroUserIdStr<'static>) -> Self {
        Self::Delegated { actor, subject }
    }

    /// Delegated to `on_behalf_of` when set, otherwise direct. Mirrors how
    /// events carry attribution as an actor plus an optional subject.
    pub fn new(actor: Actor<'static>, on_behalf_of: Option<MacroUserIdStr<'static>>) -> Self {
        match on_behalf_of {
            Some(subject) => Self::Delegated { actor, subject },
            None => Self::Direct { actor },
        }
    }

    /// Who mechanically acted.
    pub fn actor(&self) -> Actor<'static> {
        match self {
            Self::Direct { actor } | Self::Delegated { actor, .. } => actor.clone(),
        }
    }

    /// The initiating user when this action is delegated; `None` when direct.
    pub fn on_behalf_of(&self) -> Option<MacroUserIdStr<'static>> {
        match self {
            Self::Direct { .. } => None,
            Self::Delegated { subject, .. } => Some(subject.clone()),
        }
    }
}

/// The entity-kind vocabulary activities are recorded against (re-exported
/// for domain mappings).
pub use model_entity::EntityType;

/// Namespace for deriving deterministic activity ids from source event ids.
static ACTIVITY_ID_NAMESPACE: LazyLock<Uuid> =
    LazyLock::new(|| Uuid::new_v5(&Uuid::NAMESPACE_OID, b"macro.activity_events"));

/// Actions valid on every entity kind.
#[derive(Debug, Clone, PartialEq)]
pub enum CommonAction {
    /// The entity was created.
    Created,
    /// The entity's content or metadata was edited.
    Edited,
    /// The entity was opened by its subject.
    Opened,
    /// The entity was soft-deleted.
    Deleted,
    /// A property value changed on the entity. `property` is the property
    /// definition id; `from` is unset until the source event carries the
    /// previous value; `to` is `None` when the value was cleared.
    PropertyChanged(PropertyChange),
}

/// Payload of [`Action::PropertyChanged`]. Serde-derived so the write and
/// (future) read codecs share one shape definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropertyChange {
    /// Property definition id.
    pub property: String,
    /// Previous value, when known.
    pub from: Option<Value>,
    /// New value; `None` when cleared.
    pub to: Option<Value>,
}

/// Payload of [`Action::ParticipantAdded`] / [`Action::ParticipantRemoved`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParticipantChange {
    /// The (un)added principal.
    pub participant: Actor<'static>,
}

/// Payload of [`Action::CallStarted`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CallStart {
    /// The started call.
    pub call_id: String,
}

/// The durable action vocabulary — what the `action`/`action_payload`
/// columns hold. [`Action::to_columns`] is the storage codec, written out
/// explicitly; the future read path adds the inverse next to it.
///
/// This union is deliberately the one place every domain's vocabulary
/// meets: storage needs a single closed vocabulary, and reads, retention
/// policy, and the API surface stay exhaustively checkable because of it.
/// Entity-exclusive variants are reachable only through a domain's
/// [`DomainActivity`] projection.
///
/// Tags, variants, and payload fields are never renamed or repurposed —
/// stored activities are immutable and must decode forever. New payload
/// fields must tolerate absence on old rows. The stored tag is derived
/// from the variant name (strum, snake_case), so **renaming a variant is a
/// storage migration** — the pinned codec test exists to make that loud.
#[derive(Debug, Clone, PartialEq, strum::IntoStaticStr, strum::EnumDiscriminants)]
#[strum(serialize_all = "snake_case")]
#[strum_discriminants(
    name(ActionTag),
    vis(pub(crate)),
    derive(strum::EnumString),
    strum(serialize_all = "snake_case")
)]
pub enum Action {
    /// The entity was created.
    Created,
    /// The entity's content or metadata was edited.
    Edited,
    /// The entity was opened by its subject.
    Opened,
    /// The entity was soft-deleted.
    Deleted,
    /// A message was sent in the entity (channel or chat).
    Messaged,
    /// An email message was sent on the thread.
    Sent,
    /// A property value changed on the entity (see
    /// [`CommonAction::PropertyChanged`]).
    PropertyChanged(PropertyChange),
    /// A principal was added to the entity (channel membership).
    ParticipantAdded(ParticipantChange),
    /// A principal was removed from the entity (channel membership).
    ParticipantRemoved(ParticipantChange),
    /// A call was started in the entity (channel).
    CallStarted(CallStart),
}

impl From<CommonAction> for Action {
    fn from(action: CommonAction) -> Self {
        match action {
            CommonAction::Created => Action::Created,
            CommonAction::Edited => Action::Edited,
            CommonAction::Opened => Action::Opened,
            CommonAction::Deleted => Action::Deleted,
            CommonAction::PropertyChanged(change) => Action::PropertyChanged(change),
        }
    }
}

/// The stored `action` tags that [`Action::is_view`] classifies as views.
///
/// SQL surfaces that must exclude views (e.g. the soup touched-by-me page,
/// which counts mutations only) filter on these tags instead of decoding
/// every row; the pinned codec test keeps this list and `is_view` agreeing.
pub const VIEW_ACTION_TAGS: &[&str] = &["opened"];

impl Action {
    /// Whether this action is a view rather than a mutation — the only
    /// classification activity queries need.
    pub fn is_view(&self) -> bool {
        matches!(self, Action::Opened)
    }

    /// Splits the action into its `(action, action_payload)` column values:
    /// the tag from the variant name (strum), the payload from the shared
    /// serde structs. Exhaustive, so a new variant fails compilation until
    /// its payload is decided.
    pub fn to_columns(&self) -> (&'static str, Option<Value>) {
        // Payload structs are plain data (strings, options, JSON values):
        // serialization cannot fail.
        fn payload<T: Serialize>(payload: &T) -> Option<Value> {
            Some(serde_json::to_value(payload).expect("payload structs serialize infallibly"))
        }

        let tag: &'static str = self.into();
        let payload = match self {
            Action::Created
            | Action::Edited
            | Action::Opened
            | Action::Deleted
            | Action::Messaged
            | Action::Sent => None,
            Action::PropertyChanged(change) => payload(change),
            Action::ParticipantAdded(change) | Action::ParticipantRemoved(change) => {
                payload(change)
            }
            Action::CallStarted(start) => payload(start),
        };
        (tag, payload)
    }

    /// Inverse of [`Action::to_columns`]: rebuilds the action from its stored
    /// `(action, action_payload)` column values.
    ///
    /// A payload on a payload-free tag is ignored — a newer writer may have
    /// started attaching one, and old readers must keep decoding the tag they
    /// know. The tag vocabulary is the same strum derivation `to_columns`
    /// writes with (the crate-private `ActionTag` discriminant enum, derived
    /// from the variant names), and the match below is exhaustive on it — a
    /// new variant fails compilation here until its decode is written.
    pub fn from_columns(tag: &str, payload: Option<&Value>) -> Result<Self, ActionDecodeError> {
        // Deserializing from `&Value` borrows; no payload clone on the read
        // hot path.
        fn parsed<T: for<'de> Deserialize<'de>>(
            payload: Option<&Value>,
        ) -> Result<T, ActionDecodeError> {
            let value = payload.ok_or(ActionDecodeError::MissingPayload)?;
            T::deserialize(value).map_err(ActionDecodeError::InvalidPayload)
        }

        let tag = tag
            .parse::<ActionTag>()
            .map_err(|_| ActionDecodeError::UnknownTag)?;
        match tag {
            ActionTag::Created => Ok(Action::Created),
            ActionTag::Edited => Ok(Action::Edited),
            ActionTag::Opened => Ok(Action::Opened),
            ActionTag::Deleted => Ok(Action::Deleted),
            ActionTag::Messaged => Ok(Action::Messaged),
            ActionTag::Sent => Ok(Action::Sent),
            ActionTag::PropertyChanged => Ok(Action::PropertyChanged(parsed(payload)?)),
            ActionTag::ParticipantAdded => Ok(Action::ParticipantAdded(parsed(payload)?)),
            ActionTag::ParticipantRemoved => Ok(Action::ParticipantRemoved(parsed(payload)?)),
            ActionTag::CallStarted => Ok(Action::CallStarted(parsed(payload)?)),
        }
    }
}

/// Why one stored `(action, action_payload)` pair failed to decode.
#[derive(Debug)]
pub enum ActionDecodeError {
    /// The tag is not in this reader's vocabulary (row written by a newer
    /// deployment).
    UnknownTag,
    /// The tag requires a payload but the column is NULL.
    MissingPayload,
    /// The payload column doesn't deserialize into the tag's payload shape.
    InvalidPayload(serde_json::Error),
}

impl std::fmt::Display for ActionDecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ActionDecodeError::UnknownTag => write!(f, "unknown action tag"),
            ActionDecodeError::MissingPayload => write!(f, "action payload missing"),
            ActionDecodeError::InvalidPayload(e) => write!(f, "invalid action payload: {e}"),
        }
    }
}

impl std::error::Error for ActionDecodeError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ActionDecodeError::InvalidPayload(e) => Some(e),
            ActionDecodeError::UnknownTag | ActionDecodeError::MissingPayload => None,
        }
    }
}

/// A stored action as a reader sees it: decoded into the closed [`Action`]
/// vocabulary, or preserved raw when this reader can't decode it (a row
/// written by a newer deployment, or a corrupt payload). [`Action`] itself
/// stays closed — forward tolerance is a read-side concern.
#[derive(Debug, Clone, PartialEq)]
pub enum RecordedAction {
    /// An action in this reader's vocabulary.
    Known(Action),
    /// An action this reader can't decode, carried through raw.
    Unknown {
        /// The stored tag.
        tag: String,
        /// The stored payload, verbatim.
        payload: Option<Value>,
    },
}

impl RecordedAction {
    /// Total decode of the stored column pair: falls back to
    /// [`RecordedAction::Unknown`] instead of failing. The error is handed
    /// back so callers with a logging dependency can distinguish a new
    /// vocabulary word ([`ActionDecodeError::UnknownTag`], expected during
    /// rollouts) from a known tag with an undecodable payload (corruption —
    /// worth a warning). This module stays dependency-free on purpose.
    pub fn from_columns(tag: String, payload: Option<Value>) -> (Self, Option<ActionDecodeError>) {
        match Action::from_columns(&tag, payload.as_ref()) {
            Ok(action) => (RecordedAction::Known(action), None),
            Err(error) => (RecordedAction::Unknown { tag, payload }, Some(error)),
        }
    }
}

/// One activity as read back from storage — the read-side projection of an
/// `activity_events` row. Plain fields: unlike [`Activity`] there are no
/// construction invariants to seal; the row already exists.
#[derive(Debug, Clone, PartialEq)]
pub struct ActivityRecord {
    /// The stored activity id.
    pub id: Uuid,
    /// Who mechanically acted.
    pub actor: Actor<'static>,
    /// Whose activity this is (a principal string: `macro|…` or `bot|…`).
    pub subject_id: String,
    /// The kind of entity acted on.
    pub entity_type: EntityType,
    /// The entity acted on.
    pub entity_id: String,
    /// What they did, decoded forward-tolerantly.
    pub action: RecordedAction,
    /// When it happened.
    pub occurred_at: DateTime<Utc>,
}

/// The capability a domain implements to feed activity: given one of its
/// broker events, what activity happened?
///
/// Implemented on the domain's topic-event enum, next to it, by the crate
/// that owns it — the domain is the authority on what counts as activity
/// in its domain. Implementations match exhaustively (no `_` arm) so a new
/// event variant fails compilation until classified or explicitly dropped.
///
/// Takes the broker `event_id` rather than the envelope so this crate's
/// model surface stays free of broker dependencies; the id feeds
/// deterministic activity ids ([`activity_id`]) and the [`event_time`]
/// fallback. If the team later wants every topic event to declare its
/// activity semantics, `TopicEvent: ActivitySource` is the one-line
/// ratchet.
pub trait ActivitySource {
    /// Classifies one event into its ingest outcome.
    fn ingest(&self, event_id: Uuid) -> Ingest;
}

/// The contract a domain implements to contribute entity-exclusive
/// activity. The implementing crate is the authority on which actions its
/// entity kind supports and how they project into the durable [`Action`].
pub trait DomainActivity {
    /// The entity kind this activity applies to.
    const ENTITY_TYPE: EntityType;

    /// The entity acted on.
    fn entity_id(&self) -> &str;

    /// Total projection into the durable vocabulary.
    fn into_action(self) -> Action;
}

/// What ingesting one broker event asks of storage.
#[derive(Debug, Clone, PartialEq)]
pub enum Ingest {
    /// Insert these activities.
    Insert(Vec<Activity>),
    /// These entities were hard-deleted; purge their activities.
    Purge(Vec<(EntityType, String)>),
    /// The event carries no activity: pipeline noise, or a mutation with no
    /// actor (unattributable activities are dropped until a system principal
    /// exists).
    Ignore,
}

/// One activity: a principal did something to an entity at a time.
///
/// Flat — this is (nearly) the persisted row. Its invariants (valid
/// action-for-entity pairing, `subject = on_behalf_of ?? actor`,
/// deterministic id) are established at construction and sealed by
/// `#[readonly::make]`: outside this module the fields read with normal
/// syntax but cannot be written, and literal construction is impossible —
/// [`Activity::common`] and [`Activity::from_domain`] are the only doors.
#[readonly::make]
#[derive(Debug, Clone, PartialEq)]
pub struct Activity {
    /// Deterministic id: uuidv5 over (source event id, ordinal), so replays
    /// of the same broker event re-derive the same activity ids.
    pub id: Uuid,
    /// Who mechanically acted.
    pub actor: Actor<'static>,
    /// Whose activity this is: `on_behalf_of ?? actor`, resolved here at
    /// construction and never re-derived downstream.
    pub subject_id: String,
    /// The kind of entity acted on, in the soup item-type vocabulary.
    pub entity_type: EntityType,
    /// The entity acted on.
    pub entity_id: String,
    /// What they did.
    pub action: Action,
    /// When it happened, per the source event.
    pub occurred_at: DateTime<Utc>,
}

impl Activity {
    /// Builds an activity for a [`CommonAction`] from a resolved
    /// [`Attribution`].
    pub fn attributed(
        source_event_id: Uuid,
        ordinal: u32,
        attribution: Attribution,
        entity_type: EntityType,
        entity_id: impl Into<String>,
        action: CommonAction,
        occurred_at: DateTime<Utc>,
    ) -> Self {
        Self::common(
            source_event_id,
            ordinal,
            attribution.actor(),
            attribution.on_behalf_of(),
            entity_type,
            entity_id,
            action,
            occurred_at,
        )
    }

    /// Builds an activity for a [`CommonAction`] — valid on every entity
    /// kind by definition, so any (kind, id) pairing is accepted.
    #[allow(clippy::too_many_arguments)]
    pub fn common(
        source_event_id: Uuid,
        ordinal: u32,
        actor: Actor<'static>,
        on_behalf_of: Option<MacroUserIdStr<'static>>,
        entity_type: EntityType,
        entity_id: impl Into<String>,
        action: CommonAction,
        occurred_at: DateTime<Utc>,
    ) -> Self {
        Self::build(
            source_event_id,
            ordinal,
            actor,
            on_behalf_of,
            entity_type,
            entity_id.into(),
            action.into(),
            occurred_at,
        )
    }

    /// Builds an activity for an entity-exclusive action, reachable only
    /// through a domain-owned [`DomainActivity`] type.
    pub fn from_domain<A: DomainActivity>(
        source_event_id: Uuid,
        ordinal: u32,
        actor: Actor<'static>,
        on_behalf_of: Option<MacroUserIdStr<'static>>,
        entity: A,
        occurred_at: DateTime<Utc>,
    ) -> Self {
        let entity_id = entity.entity_id().to_owned();
        Self::build(
            source_event_id,
            ordinal,
            actor,
            on_behalf_of,
            A::ENTITY_TYPE,
            entity_id,
            entity.into_action(),
            occurred_at,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn build(
        source_event_id: Uuid,
        ordinal: u32,
        actor: Actor<'static>,
        on_behalf_of: Option<MacroUserIdStr<'static>>,
        entity_type: EntityType,
        entity_id: String,
        action: Action,
        occurred_at: DateTime<Utc>,
    ) -> Self {
        let subject_id = on_behalf_of
            .map(|user| user.as_ref().to_owned())
            .unwrap_or_else(|| actor.as_ref().to_owned());
        Self {
            id: activity_id(source_event_id, ordinal),
            actor,
            subject_id,
            entity_type,
            entity_id,
            action,
            occurred_at,
        }
    }
}

/// Derives the deterministic id for the `ordinal`-th activity produced by the
/// broker event `source_event_id`.
pub fn activity_id(source_event_id: Uuid, ordinal: u32) -> Uuid {
    Uuid::new_v5(
        &ACTIVITY_ID_NAMESPACE,
        format!("{source_event_id}:{ordinal}").as_bytes(),
    )
}

/// `occurred_at` fallback for events whose metadata carries no timestamp:
/// broker event ids are uuidv7, whose embedded time is when the source
/// domain published. Replays keep the first stored value regardless
/// (activity inserts are `ON CONFLICT DO NOTHING`).
pub fn event_time(event_id: Uuid) -> DateTime<Utc> {
    event_id
        .get_timestamp()
        .and_then(|ts| {
            let (seconds, nanos) = ts.to_unix();
            DateTime::from_timestamp(i64::try_from(seconds).ok()?, nanos)
        })
        .unwrap_or_else(Utc::now)
}
