//! Who receives agent trigger events outside Macro, and in what shape: the
//! access of [`AgentTriggerTopicEvent`].

use crate::domain::broker_events::{
    AgentTriggerEventName, AgentTriggerTopicEvent, ExistingAgentSessionEvent, NewAgentSessionEvent,
};
use macro_event_broker::access::EventAccess;

impl EventAccess for AgentTriggerTopicEvent {
    type PublicPayload = Self;

    fn access(
        &self,
    ) -> Result<
        macro_event_broker::access::Access<'_, Self::PublicPayload>,
        macro_event_broker::access::AccessError,
    > {
        use macro_event_broker::access::{
            Access, AccessError, Audience, EntityRef, PublicEntityType, PublicEvent, Stage,
        };
        use macro_user_id::user_id::MacroUserIdStr;
        use messages::domain::models::MessageParent;
        use std::borrow::Cow;

        // Whoever may currently read the conversation's parent: every
        // message trigger carries parent content.
        fn parent(parent: &MessageParent) -> Audience {
            Audience::Entity {
                entity_type: parent.access_entity_type(),
                entity_id: parent.entity_id(),
            }
        }

        // The entity, and the ordering key, is the bot: a subscriber consumes
        // a bot's whole trigger stream in order. The bot is not an entity
        // anyone holds access to, so the audience is whose access gates it.
        let (bot_id, audience) = match self {
            Self::New(NewAgentSessionEvent::AssignedToTask(assigned)) => {
                (assigned.bot_id, parent(&assigned.parent))
            }
            Self::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) => (
                mentioned.bot_id,
                parent(&MessageParent::Channel(mentioned.message.channel_id)),
            ),
            Self::New(NewAgentSessionEvent::Mentioned(mentioned)) => {
                (mentioned.bot_id, parent(&mentioned.message.parent))
            }
            // The one person who asked from the composer: nothing was posted,
            // so nobody else's access is in question. Their runtime, or their
            // team's, serves it.
            Self::New(NewAgentSessionEvent::Requested(requested)) => {
                let owner = MacroUserIdStr::try_from(requested.owner.clone()).map_err(|_| {
                    AccessError::InvalidEntityId {
                        entity_type: "user",
                        entity_id: requested.owner.clone(),
                    }
                })?;
                // Webhooks match the requester's workspaces (Owner). Live
                // streams also take it on the requester's own team-scoped
                // stream (a runtime shared with a team streams team-scoped)
                // and on the stream of the user the runtime authenticates
                // as, who need not be whoever asked.
                let mut audiences = vec![
                    Audience::Owner {
                        user_id: owner.clone(),
                    },
                    Audience::Person { user_id: owner },
                ];
                audiences.extend(
                    requested
                        .runtime_user
                        .clone()
                        .and_then(|user| MacroUserIdStr::try_from(user).ok())
                        .map(|user_id| Audience::Person { user_id }),
                );
                (requested.bot_id, Audience::Any(audiences))
            }
            Self::New(NewAgentSessionEvent::ConversationMessage(_)) => {
                return Ok(Access::Internal {
                    reason: "agent conversation messages reach the agent runtime without webhook or SSE delivery",
                });
            }
            Self::Existing(ExistingAgentSessionEvent::Channel(metadata)) => (
                metadata.bot_id,
                parent(&MessageParent::Channel(metadata.message.channel_id)),
            ),
            Self::Existing(ExistingAgentSessionEvent::Thread(metadata)) => {
                (metadata.bot_id, parent(&metadata.message.parent))
            }
        };
        Ok(Access::Public(PublicEvent {
            name: AgentTriggerEventName::from(self).into(),
            entity: EntityRef::new(PublicEntityType::Bot, bot_id.to_string()),
            audience,
            stage: Stage::Stable,
            payload: Cow::Borrowed(self),
        }))
    }
}
