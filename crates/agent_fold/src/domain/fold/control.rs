//! Control operations the user issues on the session.

use std::collections::HashMap;

use crate::domain::model::{Author, Control, ControlOutcome, FoldedMessage, MessagePart, TurnId};
use agent_client_protocol::schema::v1::RequestId;
use agent_runtime_protocol::domain::action::AgentActionId;
use macro_user_id::user_id::MacroUserIdStr;
use non_empty::NonEmpty;

use super::state::{Changed, FoldState, Turn};

impl FoldState {
    /// Open a turn for a compact: the invocation renders as a control part,
    /// and how it went is the turn's own reply and stop reason, not an
    /// outcome to track separately.
    pub(super) fn begin_compact(
        &mut self,
        prompt_id: &RequestId,
        user_id: Option<MacroUserIdStr<'static>>,
    ) -> Option<Changed> {
        let closed = self.close_turn(None);
        debug_assert!(closed.is_none());
        let id = TurnId(self.turns_opened);
        self.turns_opened += 1;
        let message = self.messages.len();
        self.messages.push(FoldedMessage {
            id,
            author: Author::User { user_id },
            request_id: AgentActionId::from_request_id(prompt_id),
            parts: NonEmpty::one(MessagePart::Control {
                control: Control::Compact,
                outcome: ControlOutcome::Accepted,
            }),
            stop: None,
        });
        self.turn = Some(Turn {
            id,
            prompt_id: Some(prompt_id.clone()),
            agent: None,
            permission_positions: HashMap::new(),
            plan_position: None,
            expects_reply: false,
        });
        Some(Changed::new(message))
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
