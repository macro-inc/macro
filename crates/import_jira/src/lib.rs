//! Read-only Jira Cloud workspace inventory.
#![deny(missing_docs)]

/// Source models and read ports.
pub use import_tracker::domain;
/// The provider client over the user's connected API.
pub mod outbound;
