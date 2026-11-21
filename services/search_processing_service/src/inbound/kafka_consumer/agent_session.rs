//! Lifecycle events trigger an authoritative reread, including deletion.

use ::agent_session::domain::events::{
    AgentSessionLifecycleEvent, AgentSessionLifecycleEventName, AgentSessionLifecycleMacroEvent,
};
use macro_event_broker::MacroEvent as _;

use super::{Attempted, Attempts, KafkaProcessingContext};
use crate::domain::agent_session_index::ReconcileTrigger;

/// Whether `event` can change what search reads of its session.
///
/// Three kinds never do, so they are committed without a handoff and never
/// take the session's reread claim, which would let them absorb a later event
/// that does change something. `settled` follows the `turn_ended` that already
/// changed the reply. `mentioned` is published when a prompt is accepted,
/// before the prompt reaches the log. `command_rejected` is refused before the
/// runtime, so nothing reaches the log.
pub(super) fn changes_search_projection(event: &AgentSessionLifecycleMacroEvent) -> bool {
    match &event.event().event {
        AgentSessionLifecycleEvent::Settled(_)
        | AgentSessionLifecycleEvent::Mentioned(_)
        | AgentSessionLifecycleEvent::CommandRejected(_) => false,
        AgentSessionLifecycleEvent::Opened(_)
        | AgentSessionLifecycleEvent::TurnStarted(_)
        | AgentSessionLifecycleEvent::TurnEnded(_)
        | AgentSessionLifecycleEvent::WaitingForInput(_)
        | AgentSessionLifecycleEvent::InputReceived(_)
        | AgentSessionLifecycleEvent::Stopped(_)
        | AgentSessionLifecycleEvent::Renamed(_)
        | AgentSessionLifecycleEvent::Deleted(_) => true,
    }
}

/// The session a queued reread for `event` is tracked by.
///
/// Every lifecycle event handed to a worker, whatever its kind, runs the same
/// full reconcile of its session from the owning service below, so a reread
/// queued for the session and not yet started covers any later event for it. Keep this in
/// step with [`process_agent_session_event`]: an event kind handled any other
/// way must not be coalesced.
pub(super) fn reread_key(event: &AgentSessionLifecycleMacroEvent) -> String {
    event.event().event.session_id().to_string()
}

pub(super) async fn process_agent_session_event(
    context: &KafkaProcessingContext,
    event: &AgentSessionLifecycleMacroEvent,
    attempts: &Attempts,
) -> Attempted {
    let id = event.event().event.session_id();
    let trigger =
        ReconcileTrigger::Lifecycle(AgentSessionLifecycleEventName::from(&event.event().event));
    attempts
        .run(|_| context.agent_session_indexer.reconcile(id, None, trigger))
        .await
}
