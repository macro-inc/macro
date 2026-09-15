//! Shared committed-post processing for agent trigger consumers.

use agent_session::domain::error::AgentSessionError;
use agent_session::domain::ports::AgentSessionRepo;
use channels::domain::models::ChannelType;
use macro_event_broker::{EventBrokerError, MacroEvent as _, MacroEventBroker};
use macro_uuid::Uuid;
use messages::domain::events::MessagePostedMetadata;
use messages::domain::models::MessageParent;

use super::broker_events::{AgentSessionMacroEvent, AgentTriggerEventName};
use super::service::{
    AgentBotLookup, AgentTriggerService, ChannelParticipationLookup, ExplicitReplyExtractor,
    ImplicitTriggerJudge, TeamMembershipLookup, ThreadHistory,
};

/// One committed post to evaluate, with the channel's type when the source
/// already carried it. A channel-parent trigger event keeps the channel-only
/// wire shape, which names the channel's type; the parent-aware post does not,
/// so it is looked up when absent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TriggerInput {
    /// The committed post.
    pub posted: MessagePostedMetadata,
    /// The channel's type, when the source event carried it.
    pub channel_type: Option<ChannelType>,
}

/// Channel facts a channel-parent trigger event still carries for consumers
/// built before message parents.
#[cfg_attr(test, mockall::automock)]
pub trait ChannelTypeLookup: Send + Sync + 'static {
    /// The channel's type, or `None` when no such channel exists.
    fn channel_type(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = agent_session::domain::error::Result<Option<ChannelType>>> + Send;
}

/// Failure while evaluating or publishing one message event.
#[derive(Debug, thiserror::Error)]
pub enum ProcessMessageEventError {
    /// Trigger evaluation could not read its session or bot context.
    #[error(transparent)]
    Evaluate(#[from] AgentSessionError),
    /// The channel's type could not be read for a channel-parent event.
    #[error("failed to read the channel type for a trigger event: {0}")]
    ChannelType(#[source] AgentSessionError),
    /// A yielded event could not be queued for publication.
    #[error(transparent)]
    Publish(#[from] EventBrokerError),
    /// The publication task stopped before reporting its result.
    #[error("agent event publication task failed")]
    PublishTask(#[source] tokio::task::JoinError),
}

/// Evaluate and publish all agent triggers yielded by one committed post.
///
/// Transport adapters retain ownership of decode and offset commit so their
/// `kafka.process` span can cover the complete record lifecycle. A channel
/// whose row is gone yields nothing rather than an error: nothing downstream
/// could act on it, and an error would only wedge the partition.
pub async fn process_message_event<
    Repo,
    Bots,
    Teams,
    Channels,
    Replies,
    Judge,
    History,
    Kinds,
    Broker,
>(
    trigger: &AgentTriggerService<Repo, Bots, Teams, Channels, Replies, Judge, History>,
    publisher: &Broker,
    kinds: &Kinds,
    input: &TriggerInput,
) -> Result<(), ProcessMessageEventError>
where
    Repo: AgentSessionRepo,
    Bots: AgentBotLookup,
    Teams: TeamMembershipLookup,
    Channels: ChannelParticipationLookup,
    Replies: ExplicitReplyExtractor,
    Judge: ImplicitTriggerJudge,
    History: ThreadHistory,
    Kinds: ChannelTypeLookup,
    Broker: MacroEventBroker,
{
    tracing::Span::current().record("macro.event.type", "message.posted");
    let posted = &input.posted;

    let decisions = trigger.evaluate(posted).await?;
    tracing::info!(
        message_id = %posted.message_id,
        yielded_count = decisions.len(),
        "agent trigger evaluated message"
    );
    if decisions.is_empty() {
        tracing::debug!(message_id = %posted.message_id, "agent trigger yielded no event");
        return Ok(());
    }

    let channel_type = match (&posted.parent, input.channel_type) {
        (MessageParent::Channel(_), Some(channel_type)) => Some(channel_type),
        (MessageParent::Channel(channel_id), None) => {
            match kinds
                .channel_type(*channel_id)
                .await
                .map_err(ProcessMessageEventError::ChannelType)?
            {
                Some(channel_type) => Some(channel_type),
                None => {
                    tracing::warn!(
                        message_id = %posted.message_id,
                        %channel_id,
                        dropped = decisions.len(),
                        "channel of a triggering message no longer exists; dropping its agent events"
                    );
                    return Ok(());
                }
            }
        }
        (MessageParent::Document(_), _) => None,
    };

    for decision in decisions {
        let yielded = AgentSessionMacroEvent::from_decision(decision, channel_type)
            .map_err(|error| AgentSessionError::Unknown(error.into()))?;
        let event_type: &'static str = AgentTriggerEventName::from(&yielded.event().event).into();
        tracing::info!(
            macro.event.id = %yielded.event().event_id,
            macro.event.type = event_type,
            "agent trigger yielded event"
        );
        publisher
            .send_event(&yielded)?
            .await
            .map_err(ProcessMessageEventError::PublishTask)??;
    }

    Ok(())
}
