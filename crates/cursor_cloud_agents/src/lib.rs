#![deny(missing_docs)]
//! An ACP agent backed by Cursor cloud agents.
//!
//! Cursor's cloud agents are driven over a REST API and observed over SSE;
//! ACP clients (Zed, Macro, any editor) speak newline-delimited JSON-RPC over
//! stdio or an in-process pipe. This crate is the bridge: one ACP session is
//! one Cursor *agent*,
//! one `session/prompt` is one Cursor *run*, and the run's SSE stream is
//! translated into ACP `session/update` notifications as it arrives.
//!
//! The crate is arranged hexagonally:
//!
//! - [`domain`] owns the vocabulary and the logic: the Cursor event types
//!   ([`domain::event`]), the pure translation from those events to ACP
//!   session updates ([`domain::translate`]), the ports the logic needs from
//!   the outside ([`domain::ports`]), and the session service that ties a
//!   prompt to a run ([`domain::service`]).
//! - [`api`] is the Cursor cloud API client: a plain reqwest wrapper over
//!   `api.cursor.com` plus an incremental SSE decoder. It implements the
//!   domain's [`domain::ports::CursorAgents`] and [`domain::ports::RunStream`]
//!   ports and knows nothing about ACP.
//! - [`inbound`] is the ACP adapter: it parses newline-delimited JSON-RPC
//!   frames from any reader, dispatches them to the session service, and
//!   writes responses and notifications to any writer. Nothing else ever
//!   touches that writer. Stdio is one instantiation
//!   ([`inbound::acp::AcpWriter::stdio`]); an in-process client over a
//!   `tokio::io::duplex` pipe is another.
//! - [`outbound`] holds the remaining driven adapters — today, resolving a
//!   checkout's origin remote so a session lands under the right repository
//!   in the Cursor dashboard.
//!
//! The translation is deliberately a state machine
//! ([`domain::translate::TranslateMachine`]) fed one event at a time, mirroring
//! `agent_fold`'s `FoldMachine`: the same vocabulary that renders a live
//! session here can be recorded and re-folded elsewhere, and the two cannot
//! disagree.

/// Domain models, the Cursor→ACP translation, ports, and the session service.
pub mod domain;

/// The Cursor cloud API client: reqwest + SSE, implementing the domain ports.
pub mod api;

/// The ACP stdio adapter that drives the domain from a client.
pub mod inbound;

/// Driven adapters other than the Cursor API — today, git repo resolution.
pub mod outbound;

/// Replaying recorded raw SSE back through decode → translate.
#[cfg(any(test, feature = "test-utils"))]
pub mod replay;

/// In-memory port implementations and recorded fixtures, for tests.
#[cfg(any(test, feature = "test-utils"))]
pub mod testing;
