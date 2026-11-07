//! The daemon's adapters to the Macro backend, local processes and files.
//!
//! Macro HTTP clients import request and response bodies from the owning
//! server crate rather than a copy declared here. That is the point: a
//! server-side field rename becomes a compile error on this side instead of a
//! runtime surprise on someone's laptop.

pub(crate) mod acp_probe;
pub(crate) mod acp_process;
pub mod agent_session;
pub mod link;
pub mod pairing;
#[cfg(unix)]
pub(crate) mod personas;
pub mod stream;

/// Git repository discovery and remote refresh.
pub mod git;
