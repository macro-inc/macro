//! What counts as activity in the channels domain.
//!
//! Channels own their exclusive action vocabulary and its projection into
//! the durable [`Action`] — the activity crate never learns channel
//! semantics.

#[cfg(test)]
mod test;

use ::activity::{
    Action, Activity, ActivitySource, Actor, CommonAction, DomainActivity, EntityType, Ingest,
    ParticipantChange, event_time,
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::broker_events::ChannelTopicEvent;

/// Channel-exclusive actions. Common lifecycle actions go through
/// [`Activity::common`] and need no representation here.
#[derive(Debug, Clone, PartialEq)]
pub enum ChannelAction {
    /// A message was posted in the channel.
    Messaged,
    /// A principal was added to the channel.
    ParticipantAdded {
        /// The added principal.
        participant: Actor<'static>,
    },
    /// A principal was removed from the channel.
    ParticipantRemoved {
        /// The removed principal.
        participant: Actor<'static>,
    },
}

/// A channel-exclusive activity: the channel it happened in, paired with an
/// action only channels support.
#[derive(Debug, Clone, PartialEq)]
pub struct ChannelActivity {
    /// The channel acted on.
    pub channel_id: String,
    /// What happened to it.
    pub action: ChannelAction,
}

impl DomainActivity for ChannelActivity {
    const ENTITY_TYPE: EntityType = EntityType::Channel;

    fn entity_id(&self) -> &str {
        &self.channel_id
    }

    fn into_action(self) -> Action {
        match self.action {
            ChannelAction::Messaged => Action::Messaged,
            ChannelAction::ParticipantAdded { participant } => {
                Action::ParticipantAdded(ParticipantChange { participant })
            }
            ChannelAction::ParticipantRemoved { participant } => {
                Action::ParticipantRemoved(ParticipantChange { participant })
            }
        }
    }
}

fn exclusive(
    event_id: Uuid,
    ordinal: u32,
    actor: Actor<'static>,
    on_behalf_of: Option<MacroUserIdStr<'static>>,
    channel_id: Uuid,
    action: ChannelAction,
    occurred_at: DateTime<Utc>,
) -> Activity {
    Activity::from_domain(
        event_id,
        ordinal,
        actor,
        on_behalf_of,
        ChannelActivity {
            channel_id: channel_id.to_string(),
            action,
        },
        occurred_at,
    )
}

/// One activity per (un)added participant; ordinals keep replay ids stable.
fn participant_activities(
    event_id: Uuid,
    actor: Actor<'static>,
    users: &[MacroUserIdStr<'static>],
    channel_id: Uuid,
    occurred_at: DateTime<Utc>,
    make_action: impl Fn(Actor<'static>) -> ChannelAction,
) -> Ingest {
    Ingest::Insert(
        users
            .iter()
            .enumerate()
            .map(|(ordinal, user)| {
                exclusive(
                    event_id,
                    u32::try_from(ordinal).unwrap_or(u32::MAX),
                    actor.clone(),
                    None,
                    channel_id,
                    make_action(Actor::new_from_user(user.clone())),
                    occurred_at,
                )
            })
            .collect(),
    )
}

impl ActivitySource for ChannelTopicEvent {
    /// Maps one `macro.channels` event to its ingest outcome.
    ///
    /// Exhaustive on purpose: a new event variant fails compilation here
    /// until someone classifies it or explicitly drops it.
    fn ingest(&self, event_id: Uuid) -> Ingest {
        let now = || event_time(event_id);
        let common =
            |actor: Actor<'static>, action: CommonAction, channel_id: Uuid, at: DateTime<Utc>| {
                Ingest::Insert(vec![Activity::common(
                    event_id,
                    0,
                    actor,
                    None,
                    EntityType::Channel,
                    channel_id.to_string(),
                    action,
                    at,
                )])
            };

        match self {
            ChannelTopicEvent::Created(m) => Ingest::Insert(vec![Activity::common(
                event_id,
                0,
                m.actor.clone(),
                m.on_behalf_of.clone(),
                EntityType::Channel,
                m.channel_id.to_string(),
                CommonAction::Created,
                now(),
            )]),
            ChannelTopicEvent::Updated(m) => common(
                Actor::new_from_user(m.actor.clone()),
                CommonAction::Edited,
                m.channel_id,
                now(),
            ),
            ChannelTopicEvent::Deleted(m) => {
                common(m.actor.clone(), CommonAction::Deleted, m.channel_id, now())
            }
            ChannelTopicEvent::MessagePosted(m) => {
                // For agent (bot) messages, `triggered_by` is the user whose
                // authority the message was sent under — the activity's subject.
                let on_behalf_of = m.triggered_by.as_deref().and_then(|id| {
                    MacroUserIdStr::try_from(id.to_string())
                        .inspect_err(|e| {
                            // Fall back to the sender as subject, but loudly: the
                            // triggering user's activity is being misattributed.
                            tracing::warn!(error=?e, triggered_by=id, "unparseable triggered_by");
                        })
                        .ok()
                });
                Ingest::Insert(vec![exclusive(
                    event_id,
                    0,
                    m.sender.clone(),
                    on_behalf_of,
                    m.channel_id,
                    ChannelAction::Messaged,
                    m.created_at,
                )])
            }
            ChannelTopicEvent::MessagePatched(m) => common(
                m.actor.clone(),
                CommonAction::Edited,
                m.channel_id,
                m.updated_at,
            ),
            // Deleting a message mutates the channel's content.
            ChannelTopicEvent::MessageDeleted(m) => common(
                m.actor.clone(),
                CommonAction::Edited,
                m.channel_id,
                m.deleted_at.unwrap_or_else(now),
            ),
            ChannelTopicEvent::MessageAttachmentCreated(m) => {
                common(m.actor.clone(), CommonAction::Edited, m.channel_id, now())
            }
            ChannelTopicEvent::MessageAttachmentRemoved(m) => {
                common(m.actor.clone(), CommonAction::Edited, m.channel_id, now())
            }
            ChannelTopicEvent::ParticipantAdded(m) => participant_activities(
                event_id,
                m.added_by.clone(),
                &m.added_user_ids,
                m.channel_id,
                now(),
                |participant| ChannelAction::ParticipantAdded { participant },
            ),
            ChannelTopicEvent::ParticipantRemoved(m) => participant_activities(
                event_id,
                Actor::new_from_user(m.removed_by.clone()),
                &m.removed_user_ids,
                m.channel_id,
                now(),
                |participant| ChannelAction::ParticipantRemoved { participant },
            ),
            // Derivative of MessagePosted (the full mention list travels there).
            ChannelTopicEvent::Mentioned(_) => Ingest::Ignore,
        }
    }
}
