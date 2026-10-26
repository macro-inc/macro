//! Read-only Jira Cloud workspace inventory.
#![deny(missing_docs)]

/// Source models and read ports.
pub use import_tracker::domain;
/// Provider and Pipedream adapters.
pub mod outbound;
