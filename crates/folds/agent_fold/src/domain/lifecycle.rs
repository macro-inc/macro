//! [`LifecycleFold`]: the fold, plus what each frame meant for the turn.
//!
//! The fold already knows when an agent message closes and why, what it
//! said, and which question it is holding for the user. Everything else that
//! wanted those facts used to derive them again from the raw frames - the
//! session machine parsing `stopReason` a second time, the harness refolding
//! the log to find the last passage. This wraps the fold once and hands the
//! facts back with every push as [`TurnSignal`]s, so there is one definition
//! of "the turn ended", and it is the one the chip renders from.
//!
//! Deliberately not a [`FoldMachine`](crate::domain::ports::FoldMachine): a
//! signal is inseparable from the frame that implied it, so [`push`] returns
//! the fold's events and the turn's signals together, and nothing is held
//! back for later. Folding stored history is the caller's plain decision to
//! push it and ignore what it signals - history is not news, and only the
//! caller knows which frames are history.
//!
//! [`push`]: LifecycleFold::push

use std::collections::{HashMap, HashSet};

use agent_runtime_protocol::domain::action::AgentActionId;

use crate::domain::fold::FoldMachineImpl;
use crate::domain::log::AgentSessionLog;
use crate::domain::model::{
    Author, ElicitationRequestId, FoldEvent, FoldedMessage, MessagePart, OwnedFoldEvent,
    ProjectedSegment, SessionMetadata, TurnId, TurnPhase, TurnSignal, phase, project,
};
use crate::domain::ports::FoldMachine as _;

/// What one frame did: how the fold's messages changed, and what that meant
/// for the turn.
#[derive(Debug, Default, PartialEq)]
#[must_use = "a dropped push loses the frame's turn signals"]
pub struct Pushed {
    /// The fold's own report, exactly as a bare [`FoldMachineImpl`] gives it.
    pub events: Vec<OwnedFoldEvent>,
    /// The turn facts the frame established, in order. Usually empty.
    pub signals: Vec<TurnSignal>,
}

/// A fold that also says what each frame meant for the turn's lifecycle.
#[derive(Debug, Default)]
pub struct LifecycleFold {
    inner: FoldMachineImpl,
    /// Turns already reported closed. A later update to a closed agent
    /// message must not close its turn twice.
    closed: HashSet<TurnId>,
    /// The pending elicitation after the last push, to diff against.
    pending: Option<(ElicitationRequestId, TurnId)>,
    /// The shape last reported for each open reply, to diff against. Prose
    /// still being written is absent from a shape, so a streaming passage
    /// does not report on every chunk.
    progress: HashMap<TurnId, ReplyShape>,
}

/// What [`TurnSignal::Progressed`] last said about a reply.
type ReplyShape = (Option<TurnPhase>, Vec<ProjectedSegment>);

impl LifecycleFold {
    /// A fold that has folded nothing.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Advance the fold by one frame, reporting its events and turn signals.
    pub fn push(&mut self, log: AgentSessionLog) -> Pushed {
        let events: Vec<OwnedFoldEvent> = self
            .inner
            .push(log)
            .into_iter()
            .map(FoldEvent::into_owned)
            .collect();
        let mut signals = Vec::new();
        for event in &events {
            match event {
                FoldEvent::NewMessage(message) | FoldEvent::MessageUpdate(message) => {
                    self.observe_message(message, &mut signals);
                }
                FoldEvent::MessagesReplaced(messages) => self.observe_replacement(messages),
                FoldEvent::MetadataUpdated(metadata) => {
                    self.observe_metadata(metadata, &mut signals);
                }
            }
        }
        Pushed { events, signals }
    }

    /// The fold itself, for its messages and metadata.
    #[must_use]
    pub fn inner(&self) -> &FoldMachineImpl {
        &self.inner
    }

    fn observe_message(&mut self, message: &FoldedMessage, signals: &mut Vec<TurnSignal>) {
        if !matches!(message.author, Author::Agent) || self.closed.contains(&message.id) {
            return;
        }
        let closed = message.stop.is_some();
        let shape = (
            phase(&message.parts, closed),
            project(&message.parts, closed),
        );
        let changed = self.progress.get(&message.id) != Some(&shape);
        if changed {
            let (phase, segments) = shape.clone();
            signals.push(TurnSignal::Progressed {
                turn: message.id,
                action_id: self.action_id(message),
                phase,
                segments,
            });
            self.progress.insert(message.id, shape);
        }
        let Some(stop) = &message.stop else {
            return;
        };
        self.closed.insert(message.id);
        self.progress.remove(&message.id);
        signals.push(TurnSignal::TurnEnded {
            turn: message.id,
            action_id: self.action_id(message),
            stop: stop.clone(),
            last_text: last_text(message),
        });
    }

    /// The prompt that opened the turn carries the action id; the agent's
    /// reply never does.
    fn action_id(&self, reply: &FoldedMessage) -> Option<AgentActionId> {
        self.inner
            .messages()
            .iter()
            .find(|candidate| {
                candidate.id == reply.id && matches!(candidate.author, Author::User { .. })
            })
            .and_then(|prompt| prompt.request_id)
    }

    fn observe_metadata(&mut self, metadata: &SessionMetadata, signals: &mut Vec<TurnSignal>) {
        let now = metadata
            .pending_elicitation()
            .map(|pending| (pending.request_id.clone(), TurnId(pending.turn)));
        if now == self.pending {
            return;
        }
        let before = std::mem::replace(&mut self.pending, now.clone());
        if let Some((request_id, turn)) = before {
            signals.push(TurnSignal::ElicitationCleared { turn, request_id });
        }
        if let (Some((request_id, turn)), Some(pending)) = (now, metadata.pending_elicitation()) {
            signals.push(TurnSignal::ElicitationRaised {
                turn,
                request_id,
                question: pending.message.clone(),
            });
        }
    }

    fn observe_replacement(&mut self, messages: &[FoldedMessage]) {
        // A replacement is history, not news: the next change to an open
        // reply reports its whole shape again.
        self.progress.clear();
        self.closed = messages
            .iter()
            .filter(|message| matches!(message.author, Author::Agent) && message.stop.is_some())
            .map(|message| message.id)
            .collect();
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
