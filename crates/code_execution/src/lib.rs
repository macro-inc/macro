#![deny(missing_docs)]
//! Bounded code execution with a process sandbox and a bidirectional host bridge.
//!
//! The runner has no tool credentials. A caller supplies a session-scoped
//! dispatcher to the client; the dispatcher remains in the trusted backend.

pub mod domain;
pub mod inbound;
pub mod outbound;
pub mod protocol;
