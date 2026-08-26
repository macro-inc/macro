#![deny(missing_docs)]
//! Personas: user-configured agent identities, shown to users as "agents".
//!
//! A persona is the configurable half of an agent - name, handle, avatar,
//! description, system prompt - owned and edited by one user. The running
//! half is a harness; in this iteration every persona runs on the in-memory
//! agent, so the pairing is implicit rather than stored.

/// Domain models, ports, and service.
pub mod domain;
#[cfg(feature = "inbound")]
/// Inbound HTTP adapters.
pub mod inbound;
#[cfg(feature = "outbound")]
/// Postgres adapters.
pub mod outbound;
