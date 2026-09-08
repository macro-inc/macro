//! Opening, closing, and failing turns.

use std::collections::HashMap;

use crate::domain::error::FoldError;
use crate::domain::model::{Author, FoldedMessage, MessagePart, StopReason, TurnId};
use agent_client_protocol::RawJsonRpcParams;
use agent_client_protocol::schema::v1::{PromptRequest, RequestId};
use agent_runtime_protocol::domain::action::AgentActionId;
use macro_user_id::user_id::MacroUserIdStr;
use non_empty::NonEmpty;

use super::convert::{content_block_text, deserialize_params};
use super::state::{Changed, FoldState, Turn};

impl FoldState {
    /// Handle a `session/prompt`: emit the user's message, open a turn.
    pub(super) fn begin_turn(
        &mut self,
        prompt_id: &RequestId,
        params: Option<&RawJsonRpcParams>,
        user_id: Option<MacroUserIdStr<'static>>,
    ) -> Option<Changed> {
        // A second prompt without an intervening response means the previous
        // turn never got one. Its agent message is already in `messages` and
        // already reads `stop: None`, so there is nothing left to report -
        // which is what keeps a push to one changed message.
        let closed = self.close_turn(None);
        debug_assert!(
            closed.is_none(),
            "closing a turn without a stop reason changes nothing"
        );

        let id = TurnId(self.turns_opened);
        self.turns_opened += 1;

        // A params shape this fold does not recognize derives no text, same
        // as an empty prompt - see the module docs on why a mismatch here
        // degrades rather than warns: `PromptRequest`'s own fields (a session
        // id, an optional `_meta`) carry nothing this fold renders, so there
        // is nothing to warn *about* beyond "no text," which showing no user
        // message already says.
        let text = deserialize_params::<PromptRequest>(params)
            .map(|request| {
                request
                    .prompt
                    .into_iter()
                    .filter_map(content_block_text)
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default();

        // A prompt carrying no text derives no user message, but still opens
        // the turn the agent will answer into.
        let changed = (!text.is_empty()).then(|| {
            let message = self.messages.len();
            self.messages.push(FoldedMessage {
                id,
                author: Author::User { user_id },
                request_id: AgentActionId::from_request_id(prompt_id),
                parts: NonEmpty::one(MessagePart::Text { text }),
                stop: None,
            });
            Changed::new(message)
        });

        self.turn = Some(Turn {
            id,
            prompt_id: Some(prompt_id.clone()),
            agent: None,
            permission_positions: HashMap::new(),
            plan_position: None,
            expects_reply: true,
        });

        changed
    }

    /// Handle the response to `session/prompt`: close the turn.
    pub(super) fn end_turn(
        &mut self,
        response_id: &RequestId,
        value: Option<&serde_json::Value>,
    ) -> Option<Changed> {
        let stop = value
            .and_then(|value| value.get("stopReason"))
            .and_then(|reason| reason.as_str())
            // Infallible: `StopReason`'s unmodelled variant is strum's default.
            .and_then(|reason| reason.parse().ok());

        let closes_the_open_turn = match self.turn.as_ref() {
            Some(turn) => match &turn.prompt_id {
                // The ordinary case: the response to the prompt that opened it.
                Some(prompt_id) => prompt_id == response_id,
                // A turn nothing prompted has no id to match against, so the
                // first response reporting a stop reason is taken as its
                // answer - the prompt it belongs to is in an earlier log.
                None => stop.is_some(),
            },
            None => false,
        };

        if !closes_the_open_turn {
            // Responses to `initialize`, `session/new` and `session/load`
            // land here. Only flag one that looks like a turn ending.
            if stop.is_some() {
                self.warn(FoldError::UncorrelatedResponse);
            }
            return None;
        }

        self.close_turn(stop)
    }

    /// End the open turn because its prompt was answered with an error.
    ///
    /// The turn has to end even when the agent produced nothing at all -
    /// which is the common case, since a runtime that rejects a prompt
    /// rejects it before writing anything. That is why this cannot go
    /// through [`Self::close_turn`], whose job is to stamp a stop reason on
    /// an agent message that exists: here the agent message is created if
    /// need be, so the failure has somewhere to live and the turn is
    /// unambiguously over.
    pub(super) fn fail_turn(&mut self, response_id: &RequestId, message: &str) -> Option<Changed> {
        let closes_the_open_turn = self
            .turn
            .as_ref()
            .and_then(|turn| turn.prompt_id.as_ref())
            .is_some_and(|prompt_id| prompt_id == response_id);
        if !closes_the_open_turn {
            return None;
        }

        // An error is worth showing under any turn, control's included, so
        // this mints unconditionally where a clean close does not.
        let turn = self.turn.take()?;
        let (agent, changed) = match turn.agent {
            Some(agent) => (agent, Changed::updated(agent)),
            None => self.mint_agent_message(turn.id),
        };
        self.messages[agent].stop = Some(StopReason::Failed {
            message: message.to_owned(),
        });
        Some(changed)
    }

    /// Close the open turn, recording on its agent message how it stopped.
    ///
    /// Usually the agent message has been in [`State::messages`] since the
    /// agent's first part, and all that is left is the stop reason. When the
    /// agent produced nothing at all, one is minted to carry it: readers ask
    /// whether a turn is running by looking for a stop reason on the
    /// transcript's tail, so recording none anywhere reads as working
    /// forever. That is a stop pressed before the first chunk - a first
    /// prompt spends ~10s creating the Cursor agent - which answers
    /// `session/prompt` with `cancelled` and nothing to stamp it on.
    pub(super) fn close_turn(&mut self, stop: Option<StopReason>) -> Option<Changed> {
        let Some(stop) = stop else {
            // Nothing to record, so nothing to mint a message for.
            self.turn = None;
            return None;
        };
        let turn = self.turn.take()?;
        let (message, changed) = match turn.agent {
            Some(message) => (message, Changed::updated(message)),
            // A turn a control opened is skipped by those readers, so an
            // empty agent bubble under its line would be noise, not a fix.
            None if !turn.expects_reply => return None,
            None => self.mint_agent_message(turn.id),
        };
        self.messages[message].stop = Some(stop);
        Some(changed)
    }

    /// Mint the agent message a turn never opened, so a stop reason has
    /// somewhere to sit. Reported as new: the client has not seen it.
    pub(super) fn mint_agent_message(&mut self, turn: TurnId) -> (usize, Changed) {
        let message = self.messages.len();
        self.messages.push(FoldedMessage {
            id: turn,
            author: Author::Agent,
            request_id: None,
            parts: NonEmpty::one(MessagePart::Text {
                text: String::new(),
            }),
            stop: None,
        });
        (message, Changed::new(message))
    }

    /// Open a turn for agent content that arrived without a prompt.
    ///
    /// A session resumed through `session/load` picks up mid-conversation: the
    /// prompt the agent is answering is in the log of the session it resumed,
    /// not this one. Dropping the content for want of a prompt folded such a
    /// session to nothing at all - hundreds of frames of real work rendering
    /// as an empty channel - and showing the reply without the question is
    /// plainly better than showing neither.
    ///
    /// The turn is numbered like any other and produces no user message, since
    /// there is no prompt to attribute one to. It is closed by the first
    /// response carrying a stop reason; see [`State::end_turn`].
    pub(super) fn begin_turn_without_prompt(&mut self) {
        let id = TurnId(self.turns_opened);
        self.turns_opened += 1;

        self.turn = Some(Turn {
            id,
            prompt_id: None,
            agent: None,
            permission_positions: HashMap::new(),
            plan_position: None,
            expects_reply: true,
        });
    }
}
