//! [`LifecycleFold`]: the fold, plus what each frame meant for the turn.
//!
//! The fold already knows when an agent message closes and why, what it
//! said, and which question it is holding for the user. Everything else that
//! wanted those facts used to derive them again from the raw frames - the
//! session machine parsing `stopReason` a second time, the harness refolding
//! the log to find the last passage. This wraps the fold once and hands the
//! facts out as [`TurnSignal`]s, so there is one definition of "the turn
//! ended", and it is the one the chip renders from.
//!
//! History is not news. A machine that catches up on a stored log, or has its
//! messages replaced by a `session/load`, reports the same messages the live
//! stream would have, but signals nothing for them: a reconnect must not
//! announce every past turn again.

use std::collections::HashSet;

use crate::domain::fold::FoldMachineImpl;
use crate::domain::log::AgentSessionLog;
use crate::domain::model::{
    Author, ElicitationRequestId, FoldEvent, FoldedMessage, MessagePart, SessionMetadata, TurnId,
    TurnSignal,
};
use crate::domain::ports::FoldMachine;

/// A fold that also says what each frame meant for the turn's lifecycle.
#[derive(Debug, Default)]
pub struct LifecycleFold {
    inner: FoldMachineImpl,
    /// Turns already reported closed. A later update to a closed agent
    /// message must not close its turn twice.
    closed: HashSet<TurnId>,
    /// The pending elicitation after the last push, to diff against.
    pending: Option<(ElicitationRequestId, TurnId)>,
    /// Signals implied by pushes since the last take.
    signals: Vec<TurnSignal>,
    /// While replaying stored history nothing is new, so nothing is signalled.
    replaying: bool,
}

impl LifecycleFold {
    /// A fold that has folded nothing.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold stored history silently, then resume signalling.
    pub fn catch_up(&mut self, log: impl IntoIterator<Item = AgentSessionLog>) {
        self.replaying = true;
        for entry in log {
            let _ = self.push(entry);
        }
        self.replaying = false;
    }

    /// The signals implied by pushes since the last take, in log order.
    pub fn take_signals(&mut self) -> Vec<TurnSignal> {
        std::mem::take(&mut self.signals)
    }

    /// The fold itself, for its messages and metadata.
    #[must_use]
    pub fn inner(&self) -> &FoldMachineImpl {
        &self.inner
    }

    fn observe_message(&mut self, message: &FoldedMessage) {
        let (Author::Agent, Some(stop)) = (&message.author, &message.stop) else {
            return;
        };
        if !self.closed.insert(message.id) {
            return;
        }
        if self.replaying {
            return;
        }
        // The prompt that opened the turn carries the action id; the agent's
        // reply never does.
        let action_id = self
            .inner
            .messages()
            .iter()
            .find(|candidate| {
                candidate.id == message.id && matches!(candidate.author, Author::User { .. })
            })
            .and_then(|prompt| prompt.request_id);
        self.signals.push(TurnSignal::TurnEnded {
            turn: message.id,
            action_id,
            stop: stop.clone(),
            last_text: last_text(message),
        });
    }

    fn observe_metadata(&mut self, metadata: &SessionMetadata) {
        let now = metadata
            .pending_elicitation
            .as_ref()
            .map(|pending| (pending.request_id.clone(), TurnId(pending.turn)));
        if now == self.pending {
            return;
        }
        let before = std::mem::replace(&mut self.pending, now.clone());
        if self.replaying {
            return;
        }
        if let Some((request_id, turn)) = before {
            self.signals
                .push(TurnSignal::ElicitationCleared { turn, request_id });
        }
        if let (Some((request_id, turn)), Some(pending)) = (now, &metadata.pending_elicitation) {
            self.signals.push(TurnSignal::ElicitationRaised {
                turn,
                request_id,
                question: pending.message.clone(),
            });
        }
    }

    fn observe_replacement(&mut self, messages: &[FoldedMessage]) {
        self.closed = messages
            .iter()
            .filter(|message| matches!(message.author, Author::Agent) && message.stop.is_some())
            .map(|message| message.id)
            .collect();
    }
}

impl FoldMachine for LifecycleFold {
    fn push(&mut self, log: AgentSessionLog) -> Vec<FoldEvent<'_>> {
        // The events borrow the inner machine, so they are observed owned and
        // returned borrowed: cloning what changed is cheaper than a refold and
        // keeps the pass-through contract byte for byte.
        let observed: Vec<crate::domain::model::OwnedFoldEvent> = self
            .inner
            .push(log)
            .into_iter()
            .map(FoldEvent::into_owned)
            .collect();
        for event in &observed {
            match event {
                FoldEvent::NewMessage(message) | FoldEvent::MessageUpdate(message) => {
                    self.observe_message(message);
                }
                FoldEvent::MessagesReplaced(messages) => self.observe_replacement(messages),
                FoldEvent::MetadataUpdated(metadata) => self.observe_metadata(metadata),
            }
        }
        observed
    }
}

/// The last prose part of a message, trimmed; `None` when there is none.
fn last_text(message: &FoldedMessage) -> Option<String> {
    message
        .parts
        .iter()
        .rev()
        .find_map(|part| match part {
            MessagePart::Text { text } => Some(text.trim()),
            _ => None,
        })
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}
