#![deny(missing_docs)]
//! Who may see a Macro broker event outside Macro, and in what shape.
//!
//! Every `TopicEvent` declares an [`Exposure`] per variant: either
//! [`Exposure::Internal`] with a reason, or [`Exposure::Public`] with the
//! public event name, the entity it is about, the [`Audience`] whose current
//! access decides who receives it, its rollout [`Stage`], and the explicit
//! public payload. Nothing leaves Macro unless a variant says `Public`.
//!
//! This crate is a leaf: it holds vocabulary only. Resolving an audience
//! (entity accessors, team membership, contacts) belongs to the delivery
//! crates, so producers can declare exposure without pulling in access
//! control or Kafka.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
pub use model_entity::EntityType;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::fmt;
use uuid::Uuid;

/// The exposure of one broker event variant.
///
/// `P` is the topic's public payload type. Topics with nothing public use
/// [`Unexposed`].
#[derive(Debug, Clone, PartialEq)]
pub enum Exposure<'a, P: Clone> {
    /// The event never leaves Macro.
    Internal(InternalReason),
    /// The event is delivered to its audience.
    Public(PublicEvent<'a, P>),
}

impl<P: Clone> Exposure<'_, P> {
    /// Declare an event internal by design: it is plumbing, a projection of
    /// other events, or a protocol that must not become public API.
    pub fn internal_by_design(note: &'static str) -> Self {
        Self::Internal(InternalReason::ByDesign(note))
    }

    /// Declare an event internal until a later phase makes its family public.
    pub fn pending(phase: PendingPhase, note: &'static str) -> Self {
        Self::Internal(InternalReason::PendingFamily { phase, note })
    }
}

/// A public event: what it is called, what it is about, who may see it, and
/// what they receive.
#[derive(Debug, Clone, PartialEq)]
pub struct PublicEvent<'a, P: Clone> {
    /// Public event name, such as `document.created`. Subscribers filter on
    /// it, so it is API. It equals the payload's `event_type` tag.
    pub name: &'static str,
    /// The entity the event is about. Its id is the ordering key and what
    /// subscriber `ids` filters match.
    pub entity: EntityRef,
    /// Whose current access decides who receives the event.
    pub audience: Audience,
    /// Rollout stage.
    pub stage: Stage,
    /// The public payload. Routing fields (recipients, snapshots) live on
    /// [`Self::audience`], never here.
    pub payload: Cow<'a, P>,
}

/// Rollout stage of a public event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    /// Delivered to everyone in the audience.
    Stable,
    /// Not delivered until the event stream's `public-event-stream` flag gate
    /// exists; then delivered only to flagged users.
    Preview,
}

/// Why an event is internal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InternalReason {
    /// Internal by design; never meant to be public.
    ByDesign(&'static str),
    /// Meant to become public in a later phase of the event-stream rollout.
    PendingFamily {
        /// The phase expected to make it public.
        phase: PendingPhase,
        /// What that phase needs to do, including anything the payload
        /// still lacks.
        note: &'static str,
    },
}

impl fmt::Display for InternalReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ByDesign(note) => write!(f, "internal by design: {note}"),
            Self::PendingFamily { phase, note } => {
                write!(f, "pending public family: {phase}: {note}")
            }
        }
    }
}

/// The rollout phase expected to make an internal event public.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PendingPhase {
    /// Phase 4: entity-scoped families.
    EntityFamilies,
    /// Phase 5: personal families (email, calendar, notifications,
    /// activity, mentions).
    PersonalFamilies,
    /// Phase 6: team families (teams, bots, property definitions, GitHub
    /// deliveries).
    TeamFamilies,
    /// Phase 7: the producer must first capture an audience the event lacks.
    ProducerChange,
}

impl PendingPhase {
    /// The phase number in the rollout plan.
    pub fn number(self) -> u8 {
        match self {
            Self::EntityFamilies => 4,
            Self::PersonalFamilies => 5,
            Self::TeamFamilies => 6,
            Self::ProducerChange => 7,
        }
    }
}

impl fmt::Display for PendingPhase {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "phase {}", self.number())
    }
}

/// The entity a public event is about.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct EntityRef {
    /// Public entity type.
    pub entity_type: PublicEntityType,
    /// Entity identifier.
    pub entity_id: String,
}

impl EntityRef {
    /// Reference a Macro entity.
    pub fn new(entity_type: impl Into<PublicEntityType>, entity_id: impl Into<String>) -> Self {
        Self {
            entity_type: entity_type.into(),
            entity_id: entity_id.into(),
        }
    }
}

/// The type of the entity a public event is about.
///
/// Mostly a Macro [`EntityType`]; bots and webhooks are subjects of public
/// events without being access-controlled entities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PublicEntityType {
    /// A Macro entity.
    Entity(EntityType),
    /// A bot, the subject of its agent-trigger stream.
    Bot,
    /// A webhook configuration.
    Webhook,
}

const BOT_ENTITY_TYPE: &str = "bot";
const WEBHOOK_ENTITY_TYPE: &str = "webhook";

impl PublicEntityType {
    /// The wire name, such as `document` or `bot`.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Entity(entity_type) => entity_type.into(),
            Self::Bot => BOT_ENTITY_TYPE,
            Self::Webhook => WEBHOOK_ENTITY_TYPE,
        }
    }
}

impl From<EntityType> for PublicEntityType {
    fn from(entity_type: EntityType) -> Self {
        Self::Entity(entity_type)
    }
}

impl fmt::Display for PublicEntityType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Whose current access decides who receives an event.
///
/// A rule reads only the event payload. Delivery resolves it against current
/// access when the event is fanned out. Link-share viewers are never part of
/// an audience: only explicit accessors are.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "class", content = "rule", rename_all = "snake_case")]
pub enum Audience {
    /// Explicit accessors of an entity: owner, direct grants, channel
    /// participants, team grants.
    Entity {
        /// Access entity type.
        entity_type: EntityType,
        /// Entity identifier.
        entity_id: String,
    },
    /// One addressed user, such as the recipient of a private call event.
    /// Webhooks match only that user's personal workspace.
    Recipient {
        /// The addressed user.
        user_id: MacroUserIdStr<'static>,
    },
    /// The owning user, such as a deleted session's owner. Webhooks match the
    /// owner as they match any accessor (their personal and team
    /// workspaces); streams match the owner's personal stream.
    Owner {
        /// The owning user.
        user_id: MacroUserIdStr<'static>,
    },
    /// Members of a team, optionally only those at or above a role.
    Team {
        /// The team.
        team_id: Uuid,
        /// The lowest role that receives the event.
        min_role: MinTeamRole,
    },
    /// Members of every team the user belongs to. Delivery resolves the
    /// user's teams; the payload need not list them.
    TeamsOf {
        /// The user whose teams receive the event.
        user_id: MacroUserIdStr<'static>,
    },
    /// The user and everyone in their contact graph, decided per subscriber
    /// with one exact contact lookup. Webhooks cannot enumerate contacts and
    /// match only the user's own workspaces.
    ContactsOf {
        /// The user whose contacts (and self) may see the event.
        user_id: MacroUserIdStr<'static>,
    },
    /// Whoever the GitHub App installation belongs to. Delivery resolves the
    /// installation's owners when the event is fanned out.
    GithubInstallation {
        /// The GitHub App installation id.
        installation_id: String,
    },
    /// One webhook workspace: a user's personal workspace (their user id) or
    /// a team's (the team id).
    Workspace {
        /// The workspace id.
        workspace_id: String,
    },
    /// People the producer captured because their grants are gone by the
    /// time the event is consumed, such as removed participants. Matched like
    /// [`Self::Recipient`].
    Snapshot {
        /// The captured audience.
        user_ids: Vec<MacroUserIdStr<'static>>,
    },
    /// Anyone in any of these audiences.
    Any(Vec<Audience>),
}

/// The lowest team role an [`Audience::Team`] event reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MinTeamRole {
    /// Every member.
    Member,
    /// Admins and owners only.
    Admin,
}

/// A topic payload for topics that expose nothing. It has no values, so a
/// topic using it cannot construct [`Exposure::Public`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Unexposed {}

/// The event violates the contract its exposure relies on. Retrying cannot
/// fix it, so delivery skips the event.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ExposureError {
    /// The entity or audience identifier is malformed.
    #[error("invalid {entity_type} entity id: {entity_id}")]
    InvalidEntityId {
        /// Contract entity type.
        entity_type: &'static str,
        /// The malformed identifier.
        entity_id: String,
    },
    /// A private event has no recipient to deliver to.
    #[error("private event has no recipient")]
    MissingRecipient,
}
