//! Driven adapters other than the Cursor API client.

/// Repository resolution from a checkout's git remote.
pub mod git;

/// Process-local journal for standalone agents and tests.
pub mod memory_journal;
/// Fenced durable journal for hosted sessions.
#[cfg(feature = "postgres")]
pub mod postgres_journal;
