//! Turn-level facts derived from the fold, for whoever drives a session.

use agent_runtime_protocol::domain::action::AgentActionId;
use serde::{Deserialize, Serialize};

use super::{ElicitationRequestId, ProjectedSegment, StopReason, TurnPhase};
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
    /// The agent's reply for `turn` changed shape: a segment opened or
    /// sealed, a step started or finished, or what the agent is doing
    /// changed. Prose growing inside an open passage is not a change of
    /// shape; that streams to viewers through the fold itself.
    ///
    /// Reported for a closing reply too, with every segment sealed, ahead of
    /// its [`Self::TurnEnded`], so whoever posts the reply has its final
    /// shape before it hears that the turn is over.
    Progressed {
        /// The turn whose reply changed.
        turn: TurnId,
        /// The prompt's action id, when the turn was opened by one this
        /// server minted.
        action_id: Option<AgentActionId>,
        /// What the agent is doing now; `None` once the reply has closed.
        phase: Option<TurnPhase>,
        /// The reply's segments, sealed prose with its text.
        segments: Vec<ProjectedSegment>,
    },
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
