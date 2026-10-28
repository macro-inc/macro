#![deny(missing_docs)]
//! Bounded Deno subprocess execution inside a trusted application host.
//!
//! The caller supplies a short-lived user credential and trusted API hosts.
//! Generated JavaScript imports the public SDK and calls those APIs directly;
//! the supervisor bounds process lifetime, output, and permissions.

pub mod domain;
pub mod outbound;
