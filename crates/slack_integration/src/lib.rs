#![deny(missing_docs)]
//! Browser-staged Slack archive imports, with transport-free lifecycle contracts.
//!
//! Models are always available. Enable `ports` for service and adapter contracts.
//! Enable `postgres` for durable job and upload persistence.

pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;
