//! The per-session queue of turn-occupying actions.
//!
//! Prompts (and compaction) occupy a whole agent turn, and ACP runs one turn
//! at a time - so while a turn runs, further turn-occupying actions wait here
//! rather than interleaving on the wire. Entries hold the *raw* user text:
//! composition and announcement happen at dispatch, which is what makes a
//! queued prompt editable and gives it fresh channel context when it actually
//! runs.
//!
//! In-memory on purpose. The queue lives beside the session's live actor on
//! the replica that manages it, and dies with the process - a restart loses
//! whatever was waiting, exactly like it always lost an in-flight turn.
//!
//! Callers mutate this only from the session's command worker, which is what
//! serializes an edit against the dispatch that might be claiming the same
//! entry. The structure itself only promises per-call consistency.

use std::collections::VecDeque;

use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::ports::QueuedControl;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use macro_user_id::user_id::MacroUserIdStr;

use super::model::AnnounceOrigin;

#[cfg(test)]
mod test;

/// How many actions one session may hold queued. Far above any real
/// conversation; a backstop against a runaway bot caller, not a product
/// limit.
const QUEUE_CAP: usize = 50;

/// One action waiting to dispatch.
#[derive(Debug, Clone)]
pub struct QueuedEntry {
    /// The id the action was accepted under - the queue's key, the wire's
    /// request id, and the folded message's `request_id` once dispatched.
    pub action_id: AgentActionId,
    /// What to deliver, carrying raw prompt text (see module docs).
    pub action: AgentAction,
    /// The user who queued it, absent when a bot acted on nobody's behalf.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// Where to announce the prompt at dispatch, when it came from somewhere
    /// the session should answer back into.
    pub announce: Option<AnnounceOrigin>,
    /// Whether the chip has been posted. Set by the dispatch that posts it,
    /// and carried through a requeue, so a dispatch that fails *after*
    /// announcing retries without posting a second chip.
    pub announced: bool,
    /// When it was accepted.
    pub created_at: DateTime<Utc>,
}

impl From<&QueuedEntry> for QueuedControl {
    fn from(entry: &QueuedEntry) -> Self {
        Self {
            action_id: entry.action_id,
            action: entry.action.clone(),
            actor: entry.actor.clone(),
            created_at: entry.created_at,
        }
    }
}

/// Why the queue refused a mutation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueueError {
    /// No entry under this id - it dispatched, was removed, or never existed.
    /// One answer for all three: the caller's entry is not waiting anymore,
    /// and which way it left is not knowable from here.
    NotFound,
    /// The entry exists but carries no editable text.
    NotEditable,
    /// The session already holds [`QUEUE_CAP`] entries.
    Full,
}

/// Every session's waiting actions, FIFO per session.
#[derive(Debug, Default)]
pub struct SessionQueues {
    queues: DashMap<AgentSessionId, VecDeque<QueuedEntry>>,
}

impl SessionQueues {
    /// An empty set of queues.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Append an entry to its session's queue.
    pub fn enqueue(&self, session: AgentSessionId, entry: QueuedEntry) -> Result<(), QueueError> {
        let mut queue = self.queues.entry(session).or_default();
        if queue.len() >= QUEUE_CAP {
            return Err(QueueError::Full);
        }
        queue.push_back(entry);
        Ok(())
    }

    /// Take the oldest waiting entry, if any.
    pub fn claim_next(&self, session: AgentSessionId) -> Option<QueuedEntry> {
        let mut queue = self.queues.get_mut(&session)?;
        let entry = queue.pop_front();
        if queue.is_empty() {
            drop(queue);
            // Second look under the map's own lock: an enqueue may have
            // landed between the drop and the removal, and `remove_if` is
            // what keeps this from discarding it.
            self.queues.remove_if(&session, |_, queue| queue.is_empty());
        }
        entry
    }

    /// Put a claimed entry back at the front, for a dispatch that failed
    /// with nobody waiting on it - the entry stays next in line.
    pub fn requeue_front(&self, session: AgentSessionId, entry: QueuedEntry) {
        self.queues.entry(session).or_default().push_front(entry);
    }

    /// Everything waiting for this session, oldest first.
    #[must_use]
    pub fn list(&self, session: AgentSessionId) -> Vec<QueuedControl> {
        self.queues
            .get(&session)
            .map(|queue| queue.iter().map(QueuedControl::from).collect())
            .unwrap_or_default()
    }

    /// Whether this entry is still waiting.
    #[must_use]
    pub fn contains(&self, session: AgentSessionId, action_id: AgentActionId) -> bool {
        self.queues
            .get(&session)
            .is_some_and(|queue| queue.iter().any(|entry| entry.action_id == action_id))
    }

    /// Replace a queued prompt's text. The entry keeps its place and its id.
    ///
    /// `actor` becomes the entry's actor: the user who rewrote the text is
    /// who later dispatch announces and logs as, so an edit cannot keep
    /// someone else's name on words they did not type.
    pub fn edit_prompt(
        &self,
        session: AgentSessionId,
        action_id: AgentActionId,
        prompt: String,
        actor: Option<MacroUserIdStr<'static>>,
    ) -> Result<(), QueueError> {
        let mut queue = self.queues.get_mut(&session).ok_or(QueueError::NotFound)?;
        let entry = queue
            .iter_mut()
            .find(|entry| entry.action_id == action_id)
            .ok_or(QueueError::NotFound)?;
        match &mut entry.action {
            AgentAction::Prompt(action) => {
                action.prompt = prompt;
                entry.actor = actor;
                Ok(())
            }
            AgentAction::SetModel(_) | AgentAction::Compact | AgentAction::Stop => {
                Err(QueueError::NotEditable)
            }
        }
    }

    /// Forget a session's queue wholesale - for a session that is being
    /// deleted, whose entries will never dispatch.
    pub fn drop_session(&self, session: AgentSessionId) {
        self.queues.remove(&session);
    }

    /// Remove a waiting entry.
    pub fn remove(
        &self,
        session: AgentSessionId,
        action_id: AgentActionId,
    ) -> Result<(), QueueError> {
        let mut queue = self.queues.get_mut(&session).ok_or(QueueError::NotFound)?;
        let position = queue
            .iter()
            .position(|entry| entry.action_id == action_id)
            .ok_or(QueueError::NotFound)?;
        queue.remove(position);
        if queue.is_empty() {
            drop(queue);
            self.queues.remove_if(&session, |_, queue| queue.is_empty());
        }
        Ok(())
    }
}
