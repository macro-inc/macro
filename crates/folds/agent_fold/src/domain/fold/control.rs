//! Control operations the user issues on the session.

use crate::domain::model::{Author, Control, ControlOutcome, FoldedMessage, MessagePart, TurnId};
use agent_client_protocol::schema::v1::RequestId;
use agent_runtime_protocol::domain::action::AgentActionId;
use macro_user_id::user_id::MacroUserIdStr;
use non_empty::NonEmpty;

use super::state::{Changed, FoldState};

impl FoldState {
    /// Show that the agent summarized its own context. Nothing answers it,
    /// and it is no turn: it lands between turns, or beside one running.
    pub(super) fn record_compaction(&mut self) -> Option<Changed> {
        let id = TurnId(self.turns_opened);
        self.turns_opened += 1;
        let message = self.messages.len();
        self.messages.push(FoldedMessage {
            id,
            author: Author::Agent,
            request_id: None,
            parts: NonEmpty::one(MessagePart::Control {
                control: Control::Compact,
                outcome: ControlOutcome::Accepted,
            }),
            stop: None,
            pending: self.speculative,
            posted_at: None,
        });
        Some(Changed::new(message))
    }

    /// Emit a standalone control message. A request-backed control starts
    /// pending and is resolved by its response; one with no request to answer
    /// (a stop notification) is accepted outright.
    ///
    /// A model change is punctuation *between* turns. If one lands while a
    /// turn is open — the user switched models after sending, or a speculated
    /// prompt raced the selection — later agent output must not keep the open
    /// turn's id. The transcript sorts by turn, so that leftover id put every
    /// later chunk *above* the line.
    ///
    /// A set-model with no user is the session applying its own model
    /// (create, resume, reconnect). That is not a user action and must not
    /// draw a line, or a resumed transcript grows a "Model set to" under
    /// the history it just loaded.
    pub(super) fn record_control(
        &mut self,
        control: Control,
        request_id: Option<&RequestId>,
        user_id: Option<MacroUserIdStr<'static>>,
    ) -> Option<Changed> {
        if matches!(control, Control::SetModel { .. }) && user_id.is_none() {
            return None;
        }
        if matches!(control, Control::SetModel { .. }) && self.turn.is_some() {
            // Nothing to stamp: the runtime has not ended the turn. Dropping
            // it is enough for the next agent part to open a new one after
            // this line. In-flight tool patches still find their parts by
            // session-wide tool id.
            let _ = self.close_turn(None);
        }
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
