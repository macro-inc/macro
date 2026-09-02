//! Shared channel-event processing for agent trigger consumers.

use agent_session::domain::error::AgentSessionError;
use agent_session::domain::ports::AgentSessionRepo;
use channels::domain::broker_events::{ChannelMacroEvent, ChannelTopicEvent};
use macro_event_broker::{EventBrokerError, MacroEvent as _, MacroEventBroker};

use super::broker_events::AgentTriggerEventName;
use super::service::{
    AgentBotLookup, AgentTriggerService, ChannelParticipationLookup, ExplicitReplyExtractor,
    ImplicitTriggerJudge, TeamMembershipLookup, ThreadHistory,
};

/// Failure while evaluating or publishing one channel event.
#[derive(Debug, thiserror::Error)]
pub enum ProcessChannelEventError {
    /// Trigger evaluation could not read its session or bot context.
    #[error(transparent)]
    Evaluate(#[from] AgentSessionError),
    /// A yielded event could not be queued for publication.
    #[error(transparent)]
    Publish(#[from] EventBrokerError),
    /// The publication task stopped before reporting its result.
    #[error("agent event publication task failed")]
    PublishTask(#[source] tokio::task::JoinError),
}

/// Evaluate and publish all agent triggers yielded by one channel event.
///
/// Transport adapters retain ownership of decode and offset commit so their
/// `kafka.process` span can cover the complete record lifecycle.
pub async fn process_channel_event<Repo, Bots, Teams, Channels, Replies, Judge, History, Broker>(
    trigger: &AgentTriggerService<Repo, Bots, Teams, Channels, Replies, Judge, History>,
    publisher: &Broker,
    event: &ChannelMacroEvent,
) -> Result<(), ProcessChannelEventError>
where
    Repo: AgentSessionRepo,
    Bots: AgentBotLookup,
    Teams: TeamMembershipLookup,
    Channels: ChannelParticipationLookup,
    Replies: ExplicitReplyExtractor,
    Judge: ImplicitTriggerJudge,
    History: ThreadHistory,
    Broker: MacroEventBroker,
{
    let ChannelTopicEvent::MessagePosted(posted) = &event.event().event else {
        return Ok(());
    };
    tracing::Span::current().record("macro.event.type", "channel.message_posted");

    let yielded_events = trigger.evaluate(posted).await?;
    tracing::info!(
        message_id = %posted.message_id,
        yielded_count = yielded_events.len(),
        "agent trigger evaluated channel message"
    );
    if yielded_events.is_empty() {
        tracing::debug!(message_id = %posted.message_id, "agent trigger yielded no event");
    }
    for yielded in yielded_events {
        let event_type: &'static str = AgentTriggerEventName::from(&yielded.event().event).into();
        tracing::info!(
            macro.event.id = %yielded.event().event_id,
            macro.event.type = event_type,
            "agent trigger yielded event"
        );
        publisher
            .send_event(&yielded)?
            .await
            .map_err(ProcessChannelEventError::PublishTask)??;
    }

    Ok(())
}
