#![deny(missing_docs)]
//! User-run agent harness (macrod) registration hex crate.
//!
//! A harness is a daemon a user runs on their own machine to serve agent
//! sessions with a local AI harness. This crate owns the harness registry:
//! device-code pairing (create, approve, claim), the harness list the settings
//! UI renders, revocation, and the bound-agent listing the daemon reconciles
//! its webhook feed from.

/// Domain models, ports, and service.
pub mod domain;
#[cfg(feature = "inbound")]
/// Inbound HTTP adapters.
pub mod inbound;
#[cfg(feature = "outbound")]
/// Postgres adapters.
pub mod outbound;
