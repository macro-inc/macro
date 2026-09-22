#![deny(missing_docs)]
//! Private voice conversations attached to existing agent sessions.

pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;
