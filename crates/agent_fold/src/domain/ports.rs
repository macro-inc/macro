//! The crate's ports: the query API callers use, and the log-reading
//! capability folding needs from storage.
//!
//! [`FoldedMessageRepo`] is the query API the rest of the system calls. It is
//! deliberately shaped like a repository over stored rows - list a session's
//! messages - even though nothing is stored: the service behind it derives
//! every answer from the protocol log on each call. Callers should not be
//! able to tell, and the day the messages *are* materialized somewhere, only
//! the implementation moves.
//!
//! [`LogRepo`] is the driven port: the one capability folding needs from the
//! outside, reading a session's raw log. This crate sits at the bottom of
//! the agent session stack, so it names the contract in its own vocabulary
//! ([`crate::domain::log`]) and whoever stores the log (today,
//! `agent_session`'s Postgres adapter) implements it.
//!
//! [`FoldSession`] sits between the two: "fold this session's log" as its own
//! capability, blanket-implemented for anything that is a [`LogRepo`] so
//! implementing that one method is enough to get folding for free. By
//! contrast, [`FoldedMessageRepo`] is implemented explicitly - by
//! [`FoldedMessageService`](crate::domain::service::FoldedMessageService) -
//! rather than blanket, so which types answer the query API stays a
//! deliberate choice rather than falling out of whatever implements
//! [`FoldSession`].

use crate::domain::log::{AgentSessionId, AgentSessionLog};
use crate::domain::model::{FoldEvent, FoldedMessage, TurnId};
use std::collections::VecDeque;

/// Read a session's raw protocol log.
///
/// The one capability folding needs from storage, named by this crate in its
/// own vocabulary - see the module docs.
pub trait LogRepo {
    /// A session's log rows, oldest first. A session with no log returns an
    /// empty queue.
    fn list_by_session(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<VecDeque<AgentSessionLog>, rootcause::Report>> + Send;
}

/// Fold a session's log into renderable messages.
///
/// Blanket-implemented for every [`LogRepo`] - see the module docs.
pub trait FoldSession {
    /// A session's messages, oldest first.
    fn fold_session(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<FoldedMessage>, rootcause::Report>> + Send;

    /// Turn id the next prompt in this session will open.
    fn next_turn_id(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<TurnId, rootcause::Report>> + Send;
}

/// Fold a session's log one frame at a time, reporting what each frame
/// changed.
///
/// The incremental counterpart to [`FoldSession`], which can only fold a
/// whole log at once. A machine holds the fold's state between pushes, so
/// appending one frame costs one frame's work instead of a refold, and a
/// caller streaming a live session learns which message to redraw without
/// diffing anything.
///
/// The machine is also the store: it keeps every message it has derived plus
/// the session's metadata, and [`FoldEvent`] borrows from it. Ask
/// [`FoldMachineImpl`](crate::domain::fold::FoldMachineImpl) for the whole
/// message list or the current metadata when a caller wants state rather
/// than changes.
pub trait FoldMachine {
    /// Advance the machine by one log entry, reporting every change it
    /// implied in order - empty for a frame that changes nothing.
    fn push(&mut self, log: AgentSessionLog) -> Vec<FoldEvent<'_>>;
}

/// Query a session's messages as if they were stored.
pub trait FoldedMessageRepo {
    /// A session's messages, oldest first. A session with no log folds to no
    /// messages.
    fn messages(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<FoldedMessage>, rootcause::Report>> + Send;

    /// Turn id the next prompt in this session will open.
    fn next_turn_id(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<TurnId, rootcause::Report>> + Send;
}
