//! Control operations the user issues on the session.

use crate::domain::model::{Author, Control, ControlOutcome, FoldedMessage, MessagePart, TurnId};
use agent_client_protocol::schema::v1::RequestId;
use agent_runtime_protocol::domain::action::AgentActionId;
use macro_user_id::user_id::MacroUserIdStr;
use non_empty::NonEmpty;

use super::state::{Changed, FoldState};

impl FoldState {
    /// Show that the agent summarized its own context. Nothing answers it.
    ///
    /// Between turns it is a message of its own. Within one it is a part of
    /// the turn's agent message, after whatever the agent had produced when
    /// the summary landed: as a message of its own it would sort after the
    /// whole turn, below calls that started after it.
    pub(super) fn record_compaction(&mut self) -> Option<Changed> {
        let part = MessagePart::Control {
            control: Control::Compact,
            outcome: ControlOutcome::Accepted,
        };
        // Still consumes a turn id in a turn, so every later turn keeps the
        // id a comms placeholder may have stored.
        let id = TurnId(self.turns_opened);
        self.turns_opened += 1;
        let message = self.messages.len();
        match self.turn.as_ref().map(|turn| (turn.id, turn.agent)) {
            Some((_, Some(agent))) => {
                self.messages.get_mut(agent)?.parts.push(part);
                Some(Changed::updated(agent))
            }
            Some((turn_id, None)) => {
                self.push_agent_message(turn_id, part);
                self.open_turn().agent = Some(message);
                Some(Changed::new(message))
            }
            None => {
                self.push_agent_message(id, part);
                Some(Changed::new(message))
            }
        }
    }

    fn push_agent_message(&mut self, id: TurnId, part: MessagePart) {
        self.messages.push(FoldedMessage {
            id,
            author: Author::Agent,
            request_id: None,
            parts: NonEmpty::one(part),
            stop: None,
            pending: self.speculative,
            posted_at: None,
        });
    }

    /// Emit a standalone control message. A request-backed control starts
    /// pending and is resolved by its response; one with no request to answer
    /// (a stop notification) is accepted outright.
    pub(super) fn record_control(
        &mut self,
        control: Control,
        request_id: Option<&RequestId>,
        user_id: Option<MacroUserIdStr<'static>>,
    ) -> Option<Changed> {
        let id = TurnId(self.turns_opened);
        self.turns_opened += 1;
        let message = self.messages.len();
        let outcome = match request_id {
            Some(_) => ControlOutcome::Pending,
            None => ControlOutcome::Accepted,
        };
        if let Some(request_id) = request_id {
            self.pending_controls
                .insert(request_id.clone(), (message, 0));
        }
        self.messages.push(FoldedMessage {
            id,
            author: Author::User { user_id },
            request_id: request_id.and_then(AgentActionId::from_request_id),
            parts: NonEmpty::one(MessagePart::Control { control, outcome }),
            stop: None,
            pending: self.speculative,
            posted_at: None,
        });
        Some(Changed::new(message))
    }

    /// Resolve a pending control from its response. `None` when the id
    /// matches no control.
    pub(super) fn resolve_control(
        &mut self,
        response_id: &RequestId,
        error: Option<&str>,
    ) -> Option<Changed> {
        let (message, part) = self.pending_controls.remove(response_id)?;
        let Some(MessagePart::Control { outcome, .. }) =
            self.messages.get_mut(message)?.parts.get_mut(part)
        else {
            return None;
        };
        *outcome = match error {
            Some(message) => ControlOutcome::Rejected {
                message: message.to_owned(),
            },
            None => ControlOutcome::Accepted,
        };
        Some(Changed::updated(message))
    }
}
