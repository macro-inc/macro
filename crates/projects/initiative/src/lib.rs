#![deny(missing_docs)]
//! Initiatives: a named grouping of tasks, following the hexagonal architecture
//! pattern.
//!
//! This crate owns initiative lifecycle and assignment policy.

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
