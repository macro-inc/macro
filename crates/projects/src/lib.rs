//! Projects hexagonal architecture crate.
//!
//! Encapsulates project operations using a ports-and-adapters architecture.
//! The domain owns business policy, while inbound and outbound modules adapt
//! transport and infrastructure concerns.

#![deny(missing_docs)]

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
