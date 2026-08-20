//! Inbound adapters: how a run gets triggered.
//!
//! Thin by construction - decode the broker message, ask the domain whether it
//! is addressed to us, hand one value inward. No policy lives here.

pub mod kafka;
pub mod runtime_gateway;
