#![deny(missing_docs)]
//! Folds an agent session's protocol log into renderable messages, and
//! serves them as if they were stored.
//!
//! An agent session is recorded as a flat log of Agent Runtime Protocol
//! frames - `agent_session_log`, modelled by
//! [`domain::log::AgentSessionLog`]. That log is faithful but unreadable: a
//! single session is hundreds of streamed chunks, tool-call patches and
//! token-usage reports. This crate collapses it into the handful of messages
//! a person would recognize as the story of the session.
//!
//! This crate is the bottom of the agent session stack: it owns the log
//! vocabulary ([`domain::log`]) and the fold over it, and `agent_session` -
//! which stores the log and orchestrates comms - depends on this crate, not
//! the other way around.
//!
//! Nothing here is persisted. The fiction of the crate is that folded
//! messages live in a database: [`domain::ports::FoldedMessageRepo`] is a
//! repository-shaped query API, and
//! [`domain::service::FoldedMessageService`] answers it by delegating to
//! [`domain::ports::FoldSession`], which folds through
//! [`domain::ports::LogRepo`] - the one capability it asks of whoever stores
//! the log. Because the messages are re-derived each time, the vocabulary in
//! [`domain::model`] can change without a migration.
//!
//! A caller that follows a session rather than querying it uses the fold
//! directly, as a machine: [`domain::fold::FoldMachineImpl`] takes log frames
//! one at a time through [`domain::ports::FoldMachine`] and reports which
//! message each one changed. That is the same fold - the batch form is a loop
//! over the machine - so a session rendered from the stream and the same
//! session rendered from a reload cannot disagree.
//!
//! The domain speaks only its own vocabulary - turns, tool calls,
//! permissions - and names no display type. Rendering it as something a
//! surface can show (a comms channel message or otherwise) is left to
//! whoever calls this crate.
//!
//! Querying a session, as the rest of the system does:
//!
//! ```no_run
//! use agent_fold::domain::log::AgentSessionId;
//! use agent_fold::domain::ports::{FoldedMessageRepo, LogRepo};
//! use agent_fold::domain::service::FoldedMessageService;
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
//!
//! Following one instead, a frame at a time:
//!
//! ```no_run
//! use agent_fold::domain::fold::FoldMachineImpl;
//! use agent_fold::domain::log::AgentSessionLog;
//! use agent_fold::domain::model::IncrementalFoldResult;
//! use agent_fold::domain::ports::FoldMachine;
//!
//! # fn run(frames: impl Iterator<Item = AgentSessionLog>) {
//! let mut machine = FoldMachineImpl::new();
//! for frame in frames {
//!     match machine.push(frame) {
//!         IncrementalFoldResult::NewMessage(message) => {
//!             println!("new {:?}", message.id());
//!         }
//!         IncrementalFoldResult::MessageUpdate(message) => {
//!             println!("redraw {:?}", message.id());
//!         }
//!         // Most frames are handshake or bookkeeping traffic.
//!         IncrementalFoldResult::Unchanged => {}
//!     }
//! }
//! # }
//! ```

/// Domain models, the fold, and the query port.
pub mod domain;

/// Adapters that drive the fold from outside - today, the browser's.
pub mod inbound;

/// In-memory port implementations and recorded fixtures, for tests.
#[cfg(any(test, feature = "test-utils"))]
pub mod testing;
