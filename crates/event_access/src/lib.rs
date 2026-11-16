#![deny(missing_docs)]
//! Who may receive a Macro broker event outside Macro, and in what shape.
//!
//! # The contract
//!
//! Every broker event implements [`EventAccess`]. `macro_event_broker`'s
//! `TopicEvent` requires it as a supertrait, so a topic event that does not
//! declare its access does not compile. For each event,
//! [`EventAccess::access`] answers one of two things:
//!
//! - [`Access::Internal`]: the event never leaves Macro, with the reason.
//! - [`Access::Public`]: the public event name, the entity it is about, the
//!   [`Audience`] whose current access decides who receives it, its rollout
//!   [`Stage`], and the explicit public payload.
//!
//! Nothing leaves Macro unless an event says `Public`. Delivery (live
//! streams and webhooks, `crates/event_stream` and `crates/webhook`) calls
//! [`EventAccess::access`] on every consumed event and resolves the audience
//! against current access at delivery time.
//!
//! The access model (who receives what and why, what happens when access is
//! lost, and how to expose a new family) is described in `ACCESS_MODEL.md`
//! next to this crate's `Cargo.toml`.
//!
//! This crate is a leaf: it holds the contract and its vocabulary only.
//! Resolving an audience (entity accessors, team membership, contacts)
//! belongs to the delivery crates, so producers can declare access without
//! pulling in access control or Kafka.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
pub use model_entity::EntityType;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::fmt;
use uuid::Uuid;

/// Who may receive an event outside Macro, and in what shape.
///
/// Implemented by every broker topic event (`macro_event_broker::TopicEvent`
/// requires it). The contract:
///
/// - [`Self::access`] classifies every event: it `match`es the event
///   exhaustively, with no wildcard arm (ast-grep
///   `rust-access-no-wildcard-arm`), so adding a variant forces a decision.
/// - It is pure: it reads only the event itself, never a database or the
///   clock. Audiences name *whose* access counts; delivery resolves them
///   against current access when the event is fanned out.
/// - A public event's payload is [`Self::PublicPayload`], an explicit
///   projection of the event (never the internal metadata as is). Routing
///   fields (recipients, captured audiences) go on the [`Audience`], not in
///   the payload.
/// - It fails with [`AccessError`] only when the event breaks a contract its
///   access relies on (a malformed id); delivery then skips the event.
///
/// There is no default implementation: every topic decides.
pub trait EventAccess {
    /// The public projection of this topic's events, serialized as the
    /// delivered payload. It carries the `event_type` tag and `metadata`, and
    /// derives `utoipa::ToSchema` (behind the producer's schema feature) so
    /// it can join the public event union. Topics with nothing public use
    /// [`Unexposed`].
    type PublicPayload: Serialize + Clone;

    /// Who may receive this event outside Macro, and in what shape.
    fn access(&self) -> Result<Access<'_, Self::PublicPayload>, AccessError>;
}

/// The access of one broker event.
///
/// `P` is the topic's public payload type. Topics with nothing public use
/// [`Unexposed`].
#[derive(Debug, Clone, PartialEq)]
pub enum Access<'a, P: Clone> {
    /// The event never leaves Macro.
    Internal {
        /// Why: what makes the event internal by design (plumbing, a
        /// projection of other events, a protocol that must not become public
        /// API), or what is missing before it could be public (such as an
        /// audience the payload lacks).
        reason: &'static str,
    },
    /// The event is delivered to its audience.
    Public(PublicEvent<'a, P>),
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
    /// Delivered only to users with the `public-event-stream` feature flag
    /// (streams: the stream's user; webhooks: the webhook's creator).
    Preview,
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
/// Mostly a Macro [`EntityType`]; the other variants are subjects of public
/// events without being access-controlled entities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PublicEntityType {
    /// A Macro entity.
    Entity(EntityType),
    /// A bot, the subject of its agent-trigger stream and lifecycle events.
    Bot,
    /// A webhook configuration.
    Webhook,
    /// A GitHub pull request, by its lowercased `owner/repo/pull/number` key.
    GithubPullRequest,
    /// A connected inbox (email link).
    EmailLink,
    /// A notification.
    Notification,
    /// A property definition.
    Property,
    /// A GitHub App installation.
    GithubInstallation,
}

const BOT_ENTITY_TYPE: &str = "bot";
const WEBHOOK_ENTITY_TYPE: &str = "webhook";
const GITHUB_PULL_REQUEST_ENTITY_TYPE: &str = "github_pull_request";
const EMAIL_LINK_ENTITY_TYPE: &str = "email_link";
const NOTIFICATION_ENTITY_TYPE: &str = "notification";
const PROPERTY_ENTITY_TYPE: &str = "property";
const GITHUB_INSTALLATION_ENTITY_TYPE: &str = "github_installation";

impl PublicEntityType {
    /// The wire name, such as `document` or `bot`.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Entity(entity_type) => entity_type.into(),
            Self::Bot => BOT_ENTITY_TYPE,
            Self::Webhook => WEBHOOK_ENTITY_TYPE,
            Self::GithubPullRequest => GITHUB_PULL_REQUEST_ENTITY_TYPE,
            Self::EmailLink => EMAIL_LINK_ENTITY_TYPE,
            Self::Notification => NOTIFICATION_ENTITY_TYPE,
            Self::Property => PROPERTY_ENTITY_TYPE,
            Self::GithubInstallation => GITHUB_INSTALLATION_ENTITY_TYPE,
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
    /// Explicit accessors of an entity whose access is at least `min_level`,
    /// such as a form's editors for its responses.
    EntityAtLeast {
        /// Access entity type.
        entity_type: EntityType,
        /// Entity identifier.
        entity_id: String,
        /// The lowest access level that receives the event.
        min_level: MinAccessLevel,
    },
    /// The one user an event is for: the recipient of a private call event,
    /// or the owner of personal data (their mailbox, calendar, notifications,
    /// activity feed). Personal only: webhooks match only that user's personal
    /// workspace, never their teams'; streams match only that user, and never
    /// a bot acting for them unless the bot is theirs. Declare personal
    /// families with this class, not [`Self::Owner`].
    Recipient {
        /// The addressed user.
        user_id: MacroUserIdStr<'static>,
    },
    /// The owning user, such as a deleted session's owner. Webhooks match the
    /// owner as they match any accessor (their personal and team
    /// workspaces); streams match the owner's personal stream. Because it
    /// reaches the owner's team webhooks, never use it for personal data;
    /// use [`Self::Recipient`].
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
    /// time the event is consumed, such as removed participants. Webhooks
    /// match each user's personal workspace; streams match each user's
    /// personal stream. Not a personal class: a bot acting for a captured
    /// user receives it too, unlike [`Self::Recipient`].
    Snapshot {
        /// The captured audience.
        user_ids: Vec<MacroUserIdStr<'static>>,
    },
    /// The user themself on their own live streams, in any scope: a runtime
    /// shared with a team streams team-scoped and must still receive what is
    /// addressed to the user it authenticates as. Live streams only:
    /// webhooks ignore it, so it widens stream delivery without changing
    /// which webhooks match.
    Person {
        /// The user whose own streams receive the event.
        user_id: MacroUserIdStr<'static>,
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

/// The lowest entity access level an [`Audience::EntityAtLeast`] event
/// reaches. View is [`Audience::Entity`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MinAccessLevel {
    /// Commenters, editors and owners.
    Comment,
    /// Editors and owners.
    Edit,
    /// Owners only.
    Owner,
}

/// A topic payload for topics that expose nothing. It has no values, so a
/// topic using it cannot construct [`Access::Public`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Unexposed {}

/// Parse a user id an event carries as a plain string, failing as
/// [`AccessError::InvalidEntityId`] when it is not a Macro user id.
pub fn parse_user_id(raw: &str) -> Result<MacroUserIdStr<'static>, AccessError> {
    MacroUserIdStr::try_from(raw.to_owned()).map_err(|_| AccessError::InvalidEntityId {
        entity_type: USER_ENTITY_TYPE,
        entity_id: raw.to_owned(),
    })
}

const USER_ENTITY_TYPE: &str = "user";

/// The event violates the contract its access relies on. Retrying cannot
/// fix it, so delivery skips the event.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AccessError {
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
