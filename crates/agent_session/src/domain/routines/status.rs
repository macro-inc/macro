//! Derive action completion from effective history, not connection state.

use agent_fold::domain::lifecycle::LifecycleFold;
use agent_fold::domain::model::{Author, PendingInteraction, StopReason, TurnSignal};
use agent_runtime_protocol::domain::action::AgentActionId;
use agent_runtime_protocol::domain::schema::v0::SystemEvent;

use super::models::{RoutineActionStatus, RoutineFailureReason, RoutinePendingReason};
use crate::domain::model::{SessionStatus, StoredAgentSessionLog};

pub(super) fn action_status(
    entries: Vec<StoredAgentSessionLog>,
    action_id: AgentActionId,
    session_status: &SessionStatus,
) -> RoutineActionStatus {
    let mut fold = LifecycleFold::new();
    let mut terminal = None;
    for row in entries {
        for signal in fold.push(row.entry).signals {
            if let TurnSignal::TurnEnded {
                action_id: Some(ended),
                stop,
                ..
            } = signal
                && ended == action_id
            {
                terminal = Some(classify_stop(&stop));
            }
        }
    }
    if let Some(terminal) = terminal {
        return terminal;
    }

    let messages = fold.inner().messages();
    let prompt = messages.iter().find(|message| {
        matches!(message.author, Author::User { .. }) && message.request_id == Some(action_id)
    });
    if let Some(prompt) = prompt {
        // A successful session/load replaces messages without emitting historical
        // TurnEnded signals. Its committed transcript remains authoritative.
        if let Some(stop) = messages.iter().find_map(|message| {
            (message.id == prompt.id && matches!(message.author, Author::Agent))
                .then_some(message.stop.as_ref())
                .flatten()
        }) {
            return classify_stop(stop);
        }
        for pending in &fold.inner().metadata().pending_interactions {
            if pending.turn() == prompt.id.0 {
                let reason = match pending {
                    PendingInteraction::Permission(_) => RoutinePendingReason::Permission,
                    PendingInteraction::Elicitation(_) => RoutinePendingReason::Elicitation,
                };
                return RoutineActionStatus::Pending(reason);
            }
        }
    }
    let reason = if matches!(
        session_status,
        SessionStatus::Disconnected | SessionStatus::Event(SystemEvent::Disconnected)
    ) || fold.inner().metadata().status.as_deref() == Some("disconnected")
    {
        RoutinePendingReason::Disconnected
    } else if prompt.is_some() {
        RoutinePendingReason::Running
    } else {
        RoutinePendingReason::AwaitingPrompt
    };
    RoutineActionStatus::Pending(reason)
}

fn classify_stop(stop: &StopReason) -> RoutineActionStatus {
    let failure = match stop {
        StopReason::EndTurn => return RoutineActionStatus::Succeeded,
        StopReason::Cancelled => RoutineFailureReason::Cancelled,
        StopReason::Refusal => RoutineFailureReason::Refusal,
        StopReason::MaxTokens => RoutineFailureReason::MaxTokens,
        StopReason::MaxTurnRequests => RoutineFailureReason::MaxTurnRequests,
        StopReason::Failed { .. } => RoutineFailureReason::RuntimeError,
        StopReason::Other { .. } => RoutineFailureReason::UnknownStopReason,
    };
    RoutineActionStatus::Failed(failure)
}

#[cfg(test)]
mod test;
