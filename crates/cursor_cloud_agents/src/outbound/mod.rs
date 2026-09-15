//! Driven adapters other than the Cursor API client.

/// Process-local journal for standalone agents and tests.
pub mod memory_journal;
/// Fenced durable journal for hosted sessions.
#[cfg(feature = "postgres")]
pub mod postgres_journal;
/// The pushed branch, read back from the durable journal.
#[cfg(feature = "postgres")]
pub mod pushed_branches;
/// Re-hosts artifacts on Macro's static file service.
pub mod static_file_artifacts;
