//! What counts as activity in the chat domain.

#[cfg(test)]
mod test;

use ::activity::{
    Action, Activity, ActivitySource, Actor, CommonAction, DomainActivity, EntityType, Ingest,
    event_time,
};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::events::{ChatMessageRole, ChatTopicEvent};

/// Chat-exclusive actions. Common lifecycle actions go through
/// [`Activity::common`] and need no representation here.
#[derive(Debug, Clone, PartialEq)]
pub enum ChatAction {
    /// The subject sent a message in the chat.
    Messaged,
}

/// A chat-exclusive activity.
#[derive(Debug, Clone, PartialEq)]
pub struct ChatActivity {
    /// The chat acted on.
    pub chat_id: String,
    /// What happened to it.
    pub action: ChatAction,
}

impl DomainActivity for ChatActivity {
    const ENTITY_TYPE: EntityType = EntityType::Chat;

    fn entity_id(&self) -> &str {
        &self.chat_id
    }

    fn into_action(self) -> Action {
        match self.action {
            ChatAction::Messaged => Action::Messaged,
        }
    }
}

impl ActivitySource for ChatTopicEvent {
    /// Maps one `macro.chats` event to its ingest outcome.
    ///
    /// Exhaustive on purpose: a new event variant fails compilation here
    /// until someone classifies it or explicitly drops it.
    fn ingest(&self, event_id: Uuid) -> Ingest {
        let now = || event_time(event_id);
        let common =
            |actor: Actor<'static>, action: CommonAction, chat_id: &str, at: DateTime<Utc>| {
                Ingest::Insert(vec![Activity::common(
                    event_id,
                    0,
                    actor,
                    None,
                    EntityType::Chat,
                    chat_id,
                    action,
                    at,
                )])
            };

        match self {
            ChatTopicEvent::Created(m) => common(
                Actor::new_from_user(m.owner.clone()),
                CommonAction::Created,
                &m.chat_id,
                now(),
            ),
            // The copy is a new chat; its creation is the activity.
            ChatTopicEvent::Copied(m) => common(
                Actor::new_from_user(m.owner.clone()),
                CommonAction::Created,
                &m.chat_id,
                now(),
            ),
            ChatTopicEvent::Updated(m) => common(
                Actor::new_from_user(m.actor_user_id.clone()),
                CommonAction::Edited,
                &m.chat_id,
                now(),
            ),
            // Only the user's own prompts are their activity; assistant
            // responses are a consequence, not an act by the subject.
            ChatTopicEvent::MessageSent(m) => match (&m.actor_user_id, &m.role) {
                (Some(actor), ChatMessageRole::User) => {
                    Ingest::Insert(vec![Activity::from_domain(
                        event_id,
                        0,
                        Actor::new_from_user(actor.clone()),
                        None,
                        ChatActivity {
                            chat_id: m.chat_id.clone(),
                            action: ChatAction::Messaged,
                        },
                        now(),
                    )])
                }
                _ => Ingest::Ignore,
            },
            ChatTopicEvent::Deleted(m) => match &m.actor_user_id {
                Some(actor) => common(
                    Actor::new_from_user(actor.clone()),
                    CommonAction::Deleted,
                    &m.chat_id,
                    now(),
                ),
                None => Ingest::Ignore,
            },
            // A restore is a mutation of the chat's lifecycle state.
            ChatTopicEvent::Restored(m) => match &m.actor_user_id {
                Some(actor) => common(
                    Actor::new_from_user(actor.clone()),
                    CommonAction::Edited,
                    &m.chat_id,
                    now(),
                ),
                None => Ingest::Ignore,
            },
            ChatTopicEvent::PermanentlyDeleted(m) => {
                Ingest::Purge(vec![(EntityType::Chat, m.chat_id.clone())])
            }
            // Carries no actor.
            ChatTopicEvent::MessageDeleted(_) => Ingest::Ignore,
        }
    }
}
