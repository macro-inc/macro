//! Recover action facts independently of the currently displayed replay history.

use agent_fold::domain::lifecycle::LifecycleFold;
use agent_fold::domain::model::{StopReason, TurnId, TurnSignal};
use agent_runtime_protocol::domain::action::AgentActionId;
use agent_runtime_protocol::domain::schema::v0::{
    AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage,
};

use super::model::{AgentSessionLog, Message, StoredAgentSessionLog};

/// Durable evidence that an action reached its session, and how it ended.
#[derive(Debug, PartialEq)]
pub enum RecordedAction {
    /// A prompt was recorded, without a terminal response or disconnect yet.
    Running {
        turn: TurnId,
        /// Original authenticated sender; absent on a system event.
        actor: Option<macro_user_id::user_id::MacroUserIdStr<'static>>,
    },
    /// The original ACP response, even if a later load replaced its transcript.
    Finished {
        /// A validated system-only noop, with no assistant message.
        notification_noop: bool,
        turn: TurnId,
        stop: StopReason,
        last_text: Option<String>,
    },
    /// A disconnect was recorded after the prompt and before any response.
    Interrupted { turn: TurnId },
}

pub(super) fn recorded_action(
    entries: Vec<StoredAgentSessionLog>,
    action: AgentActionId,
) -> Option<RecordedAction> {
    let mut fold = LifecycleFold::new();
    let mut prompt = None;
    let mut disconnected = false;
    let mut actor = None;
    for stored in entries {
        let mut entry = stored.entry;
        entry.logged_at = Some(stored.created_at);
        disconnected |= prompt.is_some()
            && matches!(
                entry.content,
                Message::ToServer(ToServerMessage::Event {
                    event: SystemEvent::Disconnected
                })
            );
        if is_prompt(&entry, action) {
            prompt = Some(fold.inner().next_turn_id());
            actor = entry.user_id.clone();
        }
        let answers_action = matches!(&entry.content,
            Message::ToServer(ToServerMessage::Acp(AcpMessage(frame)))
            if frame.response_id().and_then(AgentActionId::from_request_id) == Some(action));
        let pushed = fold.push(entry);
        for signal in pushed.signals {
            if let TurnSignal::TurnEnded {
                turn,
                action_id,
                stop,
                last_text,
                notification_noop,
            } = signal
                && (action_id == Some(action) || (action_id.is_none() && answers_action))
            {
                // A completed turn wins over any later disconnect or replay.
                return Some(RecordedAction::Finished {
                    notification_noop,
                    turn,
                    stop,
                    last_text,
                });
            }
        }
    }
    prompt.map(|turn| {
        if disconnected {
            RecordedAction::Interrupted { turn }
        } else {
            RecordedAction::Running { turn, actor }
        }
    })
}

/// Whether a durable outgoing prompt carries the action, even if it renders no text.
pub(crate) fn is_prompt(entry: &AgentSessionLog, action: AgentActionId) -> bool {
    matches!(&entry.content,
        Message::ToRuntime(ToRuntimeMessage::Acp(AcpMessage(agent_client_protocol::RawJsonRpcMessage::Request(request))))
        | Message::Notification(ToRuntimeMessage::Acp(AcpMessage(agent_client_protocol::RawJsonRpcMessage::Request(request))))
        if request.method.as_ref() == "session/prompt" && AgentActionId::from_request_id(&request.id) == Some(action))
}

#[cfg(test)]
mod test;
