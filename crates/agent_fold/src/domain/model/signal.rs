//! Turn-level facts derived from the fold, for whoever drives a session.

use agent_runtime_protocol::domain::action::AgentActionId;
use serde::{Deserialize, Serialize};

use super::{ElicitationRequestId, StopReason};
use crate::domain::model::TurnId;

/// A turn-level fact the fold vouches for, derived from one pushed frame.
///
/// These are what the log means for the session's lifecycle, as opposed to
/// how it renders: the harness gates its prompt queue on them and publishes
/// them downstream. Only facts the log can establish appear here. That a
/// prompt was dispatched, or that nothing is queued behind a turn, is the
/// dispatcher's knowledge and stays with it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TurnSignal {
    /// The agent's message for `turn` closed.
    TurnEnded {
        /// The turn that closed.
        turn: TurnId,
        /// The prompt's action id, when the turn was opened by one this
        /// server minted. `None` for a turn resumed from elsewhere.
        action_id: Option<AgentActionId>,
        /// How the turn stopped.
        stop: StopReason,
        /// The last text part of the agent's message, whole. `None` when the
        /// turn ended without prose.
        last_text: Option<String>,
    },
    /// The agent is holding a question for the owner.
    ElicitationRaised {
        /// The turn asking.
        turn: TurnId,
        /// The agent's request id; what an answer must name.
        request_id: ElicitationRequestId,
        /// What the agent is asking, in prose.
        question: String,
    },
    /// The held question was answered or withdrawn.
    ElicitationCleared {
        /// The turn that was asking.
        turn: TurnId,
        /// The request that was held.
        request_id: ElicitationRequestId,
    },
}
