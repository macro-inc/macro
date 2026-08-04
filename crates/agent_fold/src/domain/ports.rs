//! The crate's ports: the query API callers use, and the log-reading
//! capability folding needs from storage.
//!
//! [`FoldedMessageRepo`] is the query API the rest of the system calls. It is
//! deliberately shaped like a repository over stored rows - list a session's
//! messages, get one by id - even though nothing is stored: the service
//! behind it derives every answer from the protocol log on each call.
//! Callers should not be able to tell, and the day the messages *are*
//! materialized somewhere, only the implementation moves.
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
use crate::domain::model::{FoldedMessage, MessageId};
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
}

/// Query a session's messages as if they were stored.
pub trait FoldedMessageRepo {
    /// A session's messages, oldest first. A session with no log folds to no
    /// messages.
    fn messages(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<FoldedMessage>, rootcause::Report>> + Send;

    /// One message by its natural key, or `None` when the session's log
    /// derives no such message.
    fn get_message(
        &self,
        session: AgentSessionId,
        id: MessageId,
    ) -> impl Future<Output = Result<Option<FoldedMessage>, rootcause::Report>> + Send;

    /// The keys of the messages the session's log derives, oldest first. A
    /// session with no log derives none.
    ///
    /// This is what `agent_session`'s service polls on every append to decide
    /// which messages still need a comms placeholder. It is keyed per message
    /// rather than per turn because a turn's prompt and its reply are
    /// rendered as separate channel messages with different senders.
    fn message_ids(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<MessageId>, rootcause::Report>> + Send;
}
