//! Initiative lifecycle facts carried by the shared event broker.

#[cfg(test)]
mod test;

use std::{future::Future, pin::Pin};

use activity::{Actor, Attribution};
use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroInitiativesTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use super::models::{InitiativeError, InitiativeId};

/// Actor and optional delegating user retained on a committed mutation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InitiativeEventActor {
    /// Principal mechanically responsible for the mutation.
    pub actor: Actor<'static>,
    /// User who delegated the mutation to the actor, when any.
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
}

impl From<Attribution> for InitiativeEventActor {
    fn from(attribution: Attribution) -> Self {
        Self {
            actor: attribution.actor(),
            on_behalf_of: attribution.on_behalf_of(),
        }
    }
}

/// Attributed lifecycle event for one initiative.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InitiativeChange {
    /// Initiative that changed.
    pub initiative_id: InitiativeId,
    /// Actor, absent for unattributable internal operations.
    pub attribution: Option<InitiativeEventActor>,
    /// Time reported by the committed operation.
    pub occurred_at: DateTime<Utc>,
}

/// Events owned by initiatives. Property changes use the property domain's topic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum InitiativeTopicEvent {
    /// A project was created.
    #[serde(rename = "initiative.created")]
    Created(InitiativeChange),
    /// A project name, sharing policy, or collaborators changed.
    #[serde(rename = "initiative.updated")]
    Updated(InitiativeChange),
    /// Icon or color metadata changed without affecting content recency.
    #[serde(rename = "initiative.appearance_changed")]
    AppearanceChanged {
        /// Attribution and occurrence of the edit.
        change: InitiativeChange,
        /// Previous and saved appearance.
        appearance: activity::AppearanceChange,
    },
    /// An initiative was permanently deleted and its history must be removed.
    #[serde(rename = "initiative.purged")]
    Purged {
        /// Deleted initiative.
        initiative_id: InitiativeId,
        /// Routing: users with explicit access (direct, channel and team
        /// grants; no link viewers) just before the delete. Access rows are
        /// gone by publish time, so this snapshot is the only way to reach
        /// them. Not part of the public payload; events published before it
        /// existed decode as empty.
        #[serde(default)]
        audience_user_ids: Vec<MacroUserIdStr<'static>>,
    },
}

/// Public payload of `initiative.created`, `initiative.updated` and
/// `initiative.appearance_changed`: which initiative changed, who did it and
/// when. Read the initiative for its new state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PublicInitiativeChange {
    /// Initiative that changed.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub initiative_id: InitiativeId,
    /// Principal that made the change, when attributable.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub actor: Option<Actor<'static>>,
    /// User the actor acted for, when any.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
    /// Time of the committed change.
    pub occurred_at: DateTime<Utc>,
}

impl From<&InitiativeChange> for PublicInitiativeChange {
    fn from(change: &InitiativeChange) -> Self {
        Self {
            initiative_id: change.initiative_id,
            actor: change.attribution.as_ref().map(|by| by.actor.clone()),
            on_behalf_of: change
                .attribution
                .as_ref()
                .and_then(|by| by.on_behalf_of.clone()),
            occurred_at: change.occurred_at,
        }
    }
}

/// Public payload of `initiative.purged`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PublicInitiativePurged {
    /// The permanently deleted initiative.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub initiative_id: InitiativeId,
}

/// The public projection of [`InitiativeTopicEvent`], delivered under the
/// same event names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum InitiativePublicEvent {
    /// An initiative was created.
    #[serde(rename = "initiative.created")]
    Created(PublicInitiativeChange),
    /// An initiative's name, sharing or collaborators changed.
    #[serde(rename = "initiative.updated")]
    Updated(PublicInitiativeChange),
    /// An initiative's icon or color changed.
    #[serde(rename = "initiative.appearance_changed")]
    AppearanceChanged(PublicInitiativeChange),
    /// An initiative was permanently deleted.
    #[serde(rename = "initiative.purged")]
    Purged(PublicInitiativePurged),
}

impl TopicEvent for InitiativeTopicEvent {
    type Topic = MacroInitiativesTopic;
    const SCHEMA_VERSION: u8 = 1;

    type PublicPayload = InitiativePublicEvent;

    fn exposure(
        &self,
    ) -> Result<
        macro_event_broker::exposure::Exposure<'_, Self::PublicPayload>,
        macro_event_broker::exposure::ExposureError,
    > {
        use macro_event_broker::exposure::{
            Audience, EntityRef, EntityType, Exposure, PublicEvent, Stage,
        };
        use std::borrow::Cow;

        let entity = |initiative_id: &InitiativeId| Audience::Entity {
            entity_type: EntityType::Initiative,
            entity_id: initiative_id.to_string(),
        };
        let (name, initiative_id, audience, payload) = match self {
            Self::Created(change) => (
                "initiative.created",
                change.initiative_id,
                entity(&change.initiative_id),
                InitiativePublicEvent::Created(change.into()),
            ),
            Self::Updated(change) => (
                "initiative.updated",
                change.initiative_id,
                entity(&change.initiative_id),
                InitiativePublicEvent::Updated(change.into()),
            ),
            Self::AppearanceChanged { change, .. } => (
                "initiative.appearance_changed",
                change.initiative_id,
                entity(&change.initiative_id),
                InitiativePublicEvent::AppearanceChanged(change.into()),
            ),
            // The grants are gone by publish time: the accessors captured
            // before the delete are the audience, and they are routing only.
            Self::Purged {
                initiative_id,
                audience_user_ids,
            } => {
                if audience_user_ids.is_empty() {
                    return Ok(Exposure::internal_by_design(
                        "a purge published before audience capture has nobody left to reach",
                    ));
                }
                (
                    "initiative.purged",
                    *initiative_id,
                    Audience::Snapshot {
                        user_ids: audience_user_ids.clone(),
                    },
                    InitiativePublicEvent::Purged(PublicInitiativePurged {
                        initiative_id: *initiative_id,
                    }),
                )
            }
        };
        Ok(Exposure::Public(PublicEvent {
            name,
            entity: EntityRef::new(EntityType::Initiative, initiative_id.to_string()),
            audience,
            stage: Stage::Preview,
            payload: Cow::Owned(payload),
        }))
    }
}

/// Broker envelope keyed by the initiative that initiated the operation.
pub struct InitiativeMacroEvent {
    key: String,
    event: Event<InitiativeTopicEvent>,
}

impl InitiativeMacroEvent {
    /// Mint one stable event envelope; broker retries reuse its event id.
    pub fn new(id: InitiativeId, event: InitiativeTopicEvent) -> Self {
        Self {
            key: id.to_string(),
            event: Event::new(event),
        }
    }
}

impl MacroEvent for InitiativeMacroEvent {
    type EventPayload = InitiativeTopicEvent;
    fn key(&self) -> &str {
        &self.key
    }
    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }
    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self { key, event }
    }
}

/// Publication boundary called only after the initiative mutation has committed.
pub trait InitiativeEventPublisher: Send + Sync + 'static {
    /// Publish an envelope without changing its stable event identifier.
    fn publish(
        &self,
        event: InitiativeMacroEvent,
    ) -> Pin<Box<dyn Future<Output = Result<(), InitiativeError>> + Send + '_>>;
}

/// Convert a verified receipt into direct or delegated attribution.
#[cfg(feature = "ports")]
pub fn receipt_attribution<T: entity_access::domain::models::RequiredPermission>(
    receipt: &entity_access::domain::models::EntityAccessReceipt<T>,
) -> Option<InitiativeEventActor> {
    use entity_access::domain::models::EntityAccessAuth;
    match receipt.auth() {
        EntityAccessAuth::Authenticated(user) => Some(InitiativeEventActor {
            actor: Actor::new_from_user(user.clone()),
            on_behalf_of: None,
        }),
        EntityAccessAuth::Bot(bot) => Some(InitiativeEventActor {
            actor: Actor::new_from_bot(bot.bot_id()),
            on_behalf_of: bot.scope().acting_user_id().cloned(),
        }),
        EntityAccessAuth::Internal | EntityAccessAuth::Unauthenticated => None,
    }
}
