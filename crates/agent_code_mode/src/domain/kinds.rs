//! Each turn's code-mode kind, fixed the first time the turn asks for it.

use super::CodeModeKind;
use agent_session::domain::model::AgentSessionId;
use std::collections::{HashMap, VecDeque};

/// Turns remembered at once; past it the oldest is forgotten, long after it
/// ended.
const MAX_TURNS: usize = 8192;

/// The kinds of recent turns, by session and turn. In memory: an in-process
/// session's turn and its internal MCP calls run in one process, and a
/// sandboxed session's calls that reach another replica read the flag
/// there once for the turn, so a flag flipped mid-turn can at worst make
/// `ExecuteCode` refuse a call of the other kind.
#[derive(Default)]
pub(super) struct TurnKinds {
    kinds: HashMap<(AgentSessionId, macro_uuid::Uuid), CodeModeKind>,
    order: VecDeque<(AgentSessionId, macro_uuid::Uuid)>,
}

impl TurnKinds {
    /// The kind remembered for `turn`.
    pub(super) fn get(
        &self,
        session: AgentSessionId,
        turn: macro_uuid::Uuid,
    ) -> Option<CodeModeKind> {
        self.kinds.get(&(session, turn)).copied()
    }

    /// Remember `kind` for `turn` unless another caller got there first;
    /// the kind the turn keeps.
    pub(super) fn settle(
        &mut self,
        session: AgentSessionId,
        turn: macro_uuid::Uuid,
        kind: CodeModeKind,
    ) -> CodeModeKind {
        if let Some(settled) = self.get(session, turn) {
            return settled;
        }
        if self.order.len() == MAX_TURNS
            && let Some(oldest) = self.order.pop_front()
        {
            self.kinds.remove(&oldest);
        }
        self.order.push_back((session, turn));
        self.kinds.insert((session, turn), kind);
        kind
    }
}

#[cfg(test)]
mod test;
