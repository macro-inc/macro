#![deny(missing_docs)]
//! Folds an agent session's protocol log into renderable messages, and
//! serves them as if they were stored.
//!
//! An agent session is recorded as a flat log of Agent Runtime Protocol
//! frames - `agent_session_log`, modelled by
//! [`agent_session::domain::model::AgentSessionLog`]. That log is faithful
//! but unreadable: a single session is hundreds of streamed chunks,
//! tool-call patches and token-usage reports. This crate collapses it into
//! the handful of messages a person would recognize as the story of the
//! session.
//!
//! Nothing here is persisted. The fiction of the crate is that folded
//! messages live in a database: [`domain::ports::FoldedMessageRepo`] is a
//! repository-shaped query API, and
//! [`domain::service::FoldedMessageService`] answers it by delegating to
//! [`domain::ports::FoldSession`], which folds through
//! [`domain::ports::LogRepo`] - a port this crate names itself, rather than
//! depending on `agent_session`'s own. Because the messages are re-derived
//! each time, the vocabulary in [`domain::model`] can change without a
//! migration.
//!
//! The domain speaks only its own vocabulary - turns, tool calls,
//! permissions - and names no display type. Rendering it as something a
//! surface can show (a comms channel message or otherwise) is left to
//! whoever calls this crate.
//!
//! ```no_run
//! use agent_fold::domain::ports::{FoldedMessageRepo, LogRepo};
//! use agent_fold::domain::service::FoldedMessageService;
//! use agent_session::domain::model::AgentSessionId;
//!
//! # async fn run<R>(repo: R, session: AgentSessionId) -> Result<(), rootcause::Report>
//! # where R: LogRepo + Sync {
//! let messages = FoldedMessageService::new(repo);
//! for message in messages.messages(session).await? {
//!     println!("{:?} said {} part(s)", message.author, message.parts.len());
//! }
//! # Ok(())
//! # }
//! ```

/// Domain models, the fold, and the query port.
pub mod domain;
