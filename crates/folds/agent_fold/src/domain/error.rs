//! Frames the fold could not account for.
//!
//! Not failures - see [`crate::domain::fold`]'s module docs. [`State::warn`](
//! crate::domain::fold::State::warn) logs one of these at
//! [`tracing::Level::WARN`] and the fold carries on.

use crate::domain::model::ToolUseId;

/// Something in the log the fold could not account for.
#[derive(Debug, thiserror::Error)]
pub(crate) enum FoldError {
    /// A `tool_call_update` arrived for an id no `tool_call` had opened.
    ///
    /// Unobserved in practice: log rows are ordered by `created_at` then by a
    /// v7 uuid, which is itself time-ordered, so frames cannot be reordered.
    /// It is still reachable through `session/load`, where a resumed session's
    /// log legitimately begins mid-stream.
    #[error("tool_call_update arrived for a tool call that was never opened: {tool_call:?}")]
    PatchBeforeOpen {
        /// The unopened tool call.
        tool_call: ToolUseId,
    },
    /// A `tool_call` named a parent call the fold has not seen, or one that
    /// is not a subagent. The call is folded at top level instead.
    #[error("tool call {tool_call:?} names an unknown parent {parent:?}")]
    UnknownParent {
        /// The call that named a parent.
        tool_call: ToolUseId,
        /// The parent it named.
        parent: ToolUseId,
    },
    /// A response arrived for a request id the fold was not tracking.
    #[error("response arrived for a request id the fold was not tracking")]
    UncorrelatedResponse,
    /// A `session/update` this fold does not know what to do with - an
    /// unmodelled variant, or a frame whose params would not deserialize.
    #[error("session/update frame not understood by this fold: {kind}")]
    Unknown {
        /// The variant's wire name, when it could be read.
        kind: String,
    },
}
