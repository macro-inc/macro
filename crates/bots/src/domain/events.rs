//! Kafka event models for the `macro.bots` topic.
//!
//! Lifecycle events contain sanitized bot metadata. Bot token values, hashes,
//! identifiers, and token metadata are deliberately excluded from every payload.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroBotsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::models::{BotId, BotKind, BotOwner};

/// Metadata for [`BotTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotCreatedMetadata {
    /// Identifier of the created bot.
    pub bot_id: BotId,
    /// Kind of the created bot.
    pub kind: BotKind,
    /// User or team that owns the bot.
    pub owner: BotOwner,
    /// Display name of the bot.
    pub name: String,
    /// Stable handle of the bot.
    pub handle: String,
    /// Optional bot description.
    pub description: Option<String>,
    /// Optional bot avatar URL.
    pub avatar_url: Option<String>,
    /// Authenticated user who created the bot.
    pub created_by_user_id: MacroUserIdStr<'static>,
    /// Channel for a channel-scoped creation, if any.
    pub channel_id: Option<Uuid>,
    /// Creation timestamp reported by the repository.
    pub created_at: DateTime<Utc>,
}

/// Metadata for [`BotTopicEvent::Updated`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotUpdatedMetadata {
    /// Identifier of the updated bot.
    pub bot_id: BotId,
    /// User or team that owns the bot.
    pub owner: BotOwner,
    /// Authenticated user who updated the bot.
    pub actor_user_id: MacroUserIdStr<'static>,
    /// Requested display name, or `None` when the PATCH omitted it.
    pub name: Option<String>,
    /// Requested stable handle, or `None` when the PATCH omitted it.
    pub handle: Option<String>,
    /// Requested description, or `None` when the PATCH omitted it.
    pub description: Option<String>,
    /// Requested avatar URL, or `None` when the PATCH omitted it.
    pub avatar_url: Option<String>,
    /// Update timestamp reported by the repository.
    pub updated_at: DateTime<Utc>,
}

/// Metadata for [`BotTopicEvent::Deleted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotDeletedMetadata {
    /// Identifier of the deleted bot.
    pub bot_id: BotId,
    /// User or team that owned the bot.
    pub owner: BotOwner,
    /// Authenticated user who deleted the bot.
    pub actor_user_id: MacroUserIdStr<'static>,
}

/// Lifecycle events published to [`MacroBotsTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum BotTopicEvent {
    /// A bot was created.
    #[serde(rename = "bot.created")]
    Created(BotCreatedMetadata),
    /// A bot was updated.
    #[serde(rename = "bot.updated")]
    Updated(BotUpdatedMetadata),
    /// A bot was soft-deleted.
    #[serde(rename = "bot.deleted")]
    Deleted(BotDeletedMetadata),
}

impl TopicEvent for BotTopicEvent {
    type Topic = MacroBotsTopic;

    const SCHEMA_VERSION: u8 = 1;

    type PublicPayload = BotPublicEvent;

    fn exposure(
        &self,
    ) -> Result<
        macro_event_broker::exposure::Exposure<'_, Self::PublicPayload>,
        macro_event_broker::exposure::ExposureError,
    > {
        use macro_event_broker::exposure::{
            Audience, EntityRef, Exposure, MinTeamRole, PublicEntityType, PublicEvent, Stage,
            parse_user_id,
        };
        use std::borrow::Cow;

        let (name, bot_id, owner, payload) = match self {
            Self::Created(m) => (
                "bot.created",
                m.bot_id,
                &m.owner,
                BotPublicEvent::Created(m.into()),
            ),
            Self::Updated(m) => (
                "bot.updated",
                m.bot_id,
                &m.owner,
                BotPublicEvent::Updated(m.into()),
            ),
            Self::Deleted(m) => (
                "bot.deleted",
                m.bot_id,
                &m.owner,
                BotPublicEvent::Deleted(m.into()),
            ),
        };
        let audience = match owner {
            // A personal bot is its owner's alone: never their teams'.
            BotOwner::User { user_id } => Audience::Recipient {
                user_id: parse_user_id(user_id)?,
            },
            BotOwner::Team { team_id } => Audience::Team {
                team_id: *team_id,
                min_role: MinTeamRole::Member,
            },
        };
        Ok(Exposure::Public(PublicEvent {
            name,
            entity: EntityRef::new(PublicEntityType::Bot, bot_id.to_string()),
            audience,
            stage: Stage::Preview,
            payload: Cow::Owned(payload),
        }))
    }
}

/// The public projection of [`BotTopicEvent`], delivered to the bot's owning
/// user or team. Thin: ids, kind, owner, names and who acted; never the
/// description, avatar or tokens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum BotPublicEvent {
    /// A bot was created.
    #[serde(rename = "bot.created")]
    Created(BotCreated),
    /// A bot was updated.
    #[serde(rename = "bot.updated")]
    Updated(BotUpdated),
    /// A bot was deleted.
    #[serde(rename = "bot.deleted")]
    Deleted(BotDeleted),
}

/// Public body of `bot.created`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct BotCreated {
    /// The bot.
    pub bot_id: BotId,
    /// Its kind.
    pub kind: BotKind,
    /// The owning user or team.
    pub owner: BotOwner,
    /// Display name.
    pub name: String,
    /// Stable handle.
    pub handle: String,
    /// Who created it.
    pub actor: MacroUserIdStr<'static>,
    /// When it was created.
    pub created_at: DateTime<Utc>,
}

impl From<&BotCreatedMetadata> for BotCreated {
    fn from(metadata: &BotCreatedMetadata) -> Self {
        Self {
            bot_id: metadata.bot_id,
            kind: metadata.kind,
            owner: metadata.owner.clone(),
            name: metadata.name.clone(),
            handle: metadata.handle.clone(),
            actor: metadata.created_by_user_id.clone(),
            created_at: metadata.created_at,
        }
    }
}

/// A bot field an update changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum BotField {
    /// The display name.
    Name,
    /// The handle.
    Handle,
    /// The description.
    Description,
    /// The avatar.
    AvatarUrl,
}

/// Public body of `bot.updated`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct BotUpdated {
    /// The bot.
    pub bot_id: BotId,
    /// The owning user or team.
    pub owner: BotOwner,
    /// Who updated it.
    pub actor: MacroUserIdStr<'static>,
    /// Which fields the update set.
    pub changed: Vec<BotField>,
    /// New display name, when it changed.
    pub name: Option<String>,
    /// New handle, when it changed.
    pub handle: Option<String>,
    /// When it was updated.
    pub updated_at: DateTime<Utc>,
}

impl From<&BotUpdatedMetadata> for BotUpdated {
    fn from(metadata: &BotUpdatedMetadata) -> Self {
        let changed = [
            (metadata.name.is_some(), BotField::Name),
            (metadata.handle.is_some(), BotField::Handle),
            (metadata.description.is_some(), BotField::Description),
            (metadata.avatar_url.is_some(), BotField::AvatarUrl),
        ]
        .into_iter()
        .filter_map(|(set, field)| set.then_some(field))
        .collect();
        Self {
            bot_id: metadata.bot_id,
            owner: metadata.owner.clone(),
            actor: metadata.actor_user_id.clone(),
            changed,
            name: metadata.name.clone(),
            handle: metadata.handle.clone(),
            updated_at: metadata.updated_at,
        }
    }
}

/// Public body of `bot.deleted`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct BotDeleted {
    /// The bot.
    pub bot_id: BotId,
    /// The owning user or team.
    pub owner: BotOwner,
    /// Who deleted it.
    pub actor: MacroUserIdStr<'static>,
}

impl From<&BotDeletedMetadata> for BotDeleted {
    fn from(metadata: &BotDeletedMetadata) -> Self {
        Self {
            bot_id: metadata.bot_id,
            owner: metadata.owner.clone(),
            actor: metadata.actor_user_id.clone(),
        }
    }
}

/// Publishable lifecycle event for [`MacroBotsTopic`], keyed by bot id.
pub struct BotMacroEvent {
    key: String,
    event: Event<BotTopicEvent>,
}

impl BotMacroEvent {
    /// Build a created event keyed by the created bot id.
    pub fn created(metadata: BotCreatedMetadata) -> Self {
        let key = metadata.bot_id.to_string();
        Self::new(key, BotTopicEvent::Created(metadata))
    }

    /// Build an updated event keyed by the updated bot id.
    pub fn updated(metadata: BotUpdatedMetadata) -> Self {
        let key = metadata.bot_id.to_string();
        Self::new(key, BotTopicEvent::Updated(metadata))
    }

    /// Build a deleted event keyed by the deleted bot id.
    pub fn deleted(metadata: BotDeletedMetadata) -> Self {
        let key = metadata.bot_id.to_string();
        Self::new(key, BotTopicEvent::Deleted(metadata))
    }

    fn new(key: String, event: BotTopicEvent) -> Self {
        Self::with_event(key, Event::new(event))
    }

    fn with_event(key: String, event: Event<BotTopicEvent>) -> Self {
        Self { key, event }
    }
}

impl MacroEvent for BotMacroEvent {
    type EventPayload = BotTopicEvent;

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
