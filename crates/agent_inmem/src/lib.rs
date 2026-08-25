//! The in-memory agent runtime: an ACP agent served in-process.
//!
//! The sandboxed harness provisions a container per session and speaks ACP to
//! it over a WebSocket; this crate is the other runtime flavor. It serves the
//! agent side of ACP on an in-process channel, so a session starts in
//! milliseconds and its transport never leaves the process. The agentic loop
//! is the same one the rest of the product uses ([`agent::AgentLoop`] over the
//! Macro toolset), adapted to ACP: prompts run turns, stream parts become
//! `session/update` notifications, and the existing session log, fold, and UI
//! consume them unchanged.
//!
//! The seams:
//!
//! - [`domain::engine::TurnEngine`] runs one conversational turn and streams
//!   [`agent::StreamPart`]s back; [`outbound::rig_engine::RigTurnEngine`] is
//!   the production implementation.
//! - [`outbound::manager::InMemAgentManager`] provisions per-session agent
//!   tasks and hands the harness the [`agent_runtime_protocol`] transport it
//!   expects from any container manager.
#![deny(missing_docs)]

pub mod domain;
pub mod outbound;
#[cfg(test)]
pub(crate) mod testing;
