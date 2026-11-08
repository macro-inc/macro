//! Worker-independent document synchronization policy and persisted domain types.
#![deny(missing_docs)]

/// Synchronization policy and domain models.
pub mod domain;

/// Optional pure comment-only gate shared by production and simulation.
#[cfg(feature = "in-process-gate")]
pub mod comment_gate;
