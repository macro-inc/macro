//! Composable parts for a Macro team agent's long-running daemon.
//!
//! A team agent is a Macro user whose brain is a coding agent (Claude Code
//! or similar) on its own machine. This crate is the toolkit that agent uses
//! to build itself a daemon: listen to Macro events, decide cheaply whether
//! an event deserves its attention, queue relevant events per conversation,
//! and wake itself to act, plus heartbeats for proactive work. It is a set
//! of parts, not a framework: assemble the ones you want in your own `main`.
//!
//! | Module | Part |
//! | --- | --- |
//! | [`client`] | [`MacroClient`]: messages, typing, channels, decisions, email, agent sessions |
//! | [`events`] | [`EventStream`]: typed, reconnecting event stream |
//! | [`relevance`] | [`Relevance`]: the agent-tuned "should I wake?" check (Jev) |
//! | [`queue`] | [`ConversationQueue`]: durable per-conversation batches |
//! | [`wake`] | [`Waker`], [`CommandWaker`], [`SessionWaker`], [`TypingGuard`] |
//! | [`schedule`] | [`Job`]: heartbeats and cron |
//! | [`memory`] | [`StateDir`], [`History`], JSONL helpers, [`prune`](memory::prune) |
//! | [`prompt`] | [`TurnPrompt`]: instructions + batch + history |
//!
//! `README.md` walks through a complete daemon; `examples/daemon.rs` is the
//! same program, compile-checked.

#![deny(missing_docs)]

pub mod client;
pub mod error;
pub mod events;
pub mod memory;
pub mod prompt;
pub mod queue;
pub mod relevance;
pub mod schedule;
pub mod wake;

pub use client::{Environment, Hosts, MacroClient};
pub use error::{Error, Result};
pub use events::{Event, EventFilter, EventKind, EventStream, StreamItem};
pub use memory::{History, MessageRecord, StateDir};
pub use prompt::TurnPrompt;
pub use queue::ConversationQueue;
pub use relevance::{Candidate, Decision, Relevance, RelevanceConfig};
pub use schedule::{Job, Trigger};
pub use tokio_util::sync::CancellationToken;
pub use wake::{CommandWaker, SessionWaker, Turn, TurnOutcome, TypingGuard, Waker};
