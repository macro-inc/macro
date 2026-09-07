#![deny(missing_docs)]

//! Built-in agents for document comments and channel messages.
//!
//! The common message service emits committed posts for both channels and documents.
//! Built-in agents read, authorize, and deliver through the same message boundary.

pub mod domain;
/// Inbound adapters for channel bot triggers.
pub mod inbound;
/// Outbound adapters for channel bot dependencies.
pub mod outbound;
